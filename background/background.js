/**
 * Background Service Worker — WebWright Extension v2
 * ═══════════════════════════════════════════════════════════
 * Multi-provider LLM support (Ollama Cloud/Local, ChatGPT, Claude, Gemini)
 * DOM-first agent loop with aggressive vision escalation.
 * Chat mode: page summary + conversational Q&A.
 * Auto-fallback to google.com when content script injection fails.
 *
 * v2 Changes:
 *   - Chat mode (CHAT_MESSAGE, CHAT_INIT)
 *   - Removed 300-element cap for vision escalation
 *   - Escalate to vision on: JSON parse failure, missing selector,
 *     hallucinated IDs, repeated actions, execution failures
 *   - Show LLM "thinking" (raw content) in logs before parsing
 */

/* ───────────────────────────────────────────
 * Side Panel hehe
 * ─────────────────────────────────────────── */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

/* ───────────────────────────────────────────
 * Agent State
 * ─────────────────────────────────────────── */

const agentState = {
  running: false,
  goal: "",
  tabId: null,
  step: 0,
  maxSteps: 20,
  history: [],
  lastThinking: "",
  logs: [],
  interStepDelay: 2000,
  llmTimeout: 15000,
  aborted: false,
  wallTimeout: 300000,

  provider: "ollama_cloud",
  endpoint: "",
  apiKey: "",
  model: "",
  visionModel: "",
  researchModel: "",

};

/* ───────────────────────────────────────────
 * Chrome Debugger (CDP) State
 * ─────────────────────────────────────────── */

const debuggerState = {
  attached: false,
  tabId: null,
  networkPending: 0,
  networkEnabled: false,
};

async function attachDebugger(tabId) {
  if (debuggerState.attached && debuggerState.tabId === tabId) return true;
  if (debuggerState.attached) await detachDebugger();
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    debuggerState.attached = true;
    debuggerState.tabId = tabId;
    return true;
  } catch (err) {
    broadcastLog({ kind: "system", label: "Debugger Unavailable", data: { error: err.message, note: "Falling back to synthetic events" } });
    return false;
  }
}

async function detachDebugger() {
  if (!debuggerState.attached) return;
  const tid = debuggerState.tabId;
  debuggerState.attached = false;
  debuggerState.tabId = null;
  debuggerState.networkPending = 0;
  debuggerState.networkEnabled = false;
  try { await chrome.debugger.detach({ tabId: tid }); } catch {}
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === debuggerState.tabId) {
    debuggerState.attached = false;
    debuggerState.tabId = null;
    debuggerState.networkPending = 0;
    debuggerState.networkEnabled = false;
  }
});

/* ───────────────────────────────────────────
 * SPA Navigation Detection
 * ─────────────────────────────────────────── */

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.tabId === agentState.tabId && details.frameId === 0) {
    agentState._spaNavigated = true;
  }
});

/* ───────────────────────────────────────────
 * CDP Network Idle Detection
 * ─────────────────────────────────────────── */

chrome.debugger.onEvent.addListener((source, method) => {
  if (source.tabId !== debuggerState.tabId) return;
  if (method === "Network.requestWillBeSent") {
    debuggerState.networkPending++;
  }
  if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
    debuggerState.networkPending = Math.max(0, debuggerState.networkPending - 1);
  }
});

async function enableNetworkTracking() {
  if (!debuggerState.attached) return;
  try {
    await cdpSend("Network.enable", {});
    debuggerState.networkEnabled = true;
  } catch (err) {
    broadcastLog({ kind: "system", label: "Network Tracking Unavailable", data: { error: err.message } });
  }
}

async function waitForNetworkIdle(timeout, idleDuration) {
  timeout = timeout || 5000;
  idleDuration = idleDuration || 500;
  if (!debuggerState.networkEnabled) return;
  const start = Date.now();
  let idleSince = null;
  while (Date.now() - start < timeout) {
    if (debuggerState.networkPending === 0) {
      if (!idleSince) idleSince = Date.now();
      if (Date.now() - idleSince >= idleDuration) return;
    } else {
      idleSince = null;
    }
    await sleep(100);
  }
}

/* ───────────────────────────────────────────
 * CDP Action Primitives
 * ─────────────────────────────────────────── */

async function cdpSend(method, params) {
  if (!debuggerState.attached) throw new Error("Debugger not attached");
  return chrome.debugger.sendCommand({ tabId: debuggerState.tabId }, method, params || {});
}

const CDP_KEY_MAP = {
  Enter:      { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
  Tab:        { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
  Escape:     { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  Backspace:  { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 },
  Delete:     { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 },
  ArrowDown:  { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
  ArrowUp:    { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
  ArrowLeft:  { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
  " ":        { key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 },
  Home:       { key: "Home", code: "Home", windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36 },
  End:        { key: "End", code: "End", windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 },
  PageUp:     { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33, nativeVirtualKeyCode: 33 },
  PageDown:   { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34, nativeVirtualKeyCode: 34 },
};

async function cdpClick(x, y) {
  x = Math.round(x);
  y = Math.round(y);
  await cdpSend("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdpSend("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function cdpDoubleClick(x, y) {
  x = Math.round(x);
  y = Math.round(y);
  await cdpSend("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdpSend("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await cdpSend("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 2 });
  await cdpSend("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 2 });
}

async function cdpHover(x, y) {
  x = Math.round(x);
  y = Math.round(y);
  await cdpSend("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

async function cdpType(text) {
  await cdpSend("Input.insertText", { text });
}

async function cdpKeyPress(key) {
  const desc = CDP_KEY_MAP[key];
  if (desc) {
    await cdpSend("Input.dispatchKeyEvent", { type: "keyDown", ...desc });
    await cdpSend("Input.dispatchKeyEvent", { type: "keyUp", ...desc });
  } else if (key.length === 1) {
    // Single character — send as rawKeyDown + char + keyUp
    await cdpSend("Input.dispatchKeyEvent", { type: "keyDown", key, text: key, unmodifiedText: key });
    await cdpSend("Input.dispatchKeyEvent", { type: "keyUp", key });
  } else {
    // Unknown named key — best effort
    await cdpSend("Input.dispatchKeyEvent", { type: "keyDown", key, code: key });
    await cdpSend("Input.dispatchKeyEvent", { type: "keyUp", key, code: key });
  }
}

async function cdpSelectAll() {
  // Ctrl+A to select all text in focused input
  await cdpSend("Input.dispatchKeyEvent", {
    type: "keyDown", key: "a", code: "KeyA",
    windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
    modifiers: 2 // Ctrl
  });
  await cdpSend("Input.dispatchKeyEvent", {
    type: "keyUp", key: "a", code: "KeyA",
    windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
    modifiers: 2
  });
}

async function cdpScroll(x, y, deltaX, deltaY) {
  await cdpSend("Input.dispatchMouseEvent", {
    type: "mouseWheel", x: Math.round(x), y: Math.round(y),
    deltaX: deltaX || 0, deltaY: deltaY || 0
  });
}

/* ───────────────────────────────────────────
 * Chat State
 * ─────────────────────────────────────────── */

const chatState = {
  active: false,
  pageSummary: null,
  messages: [],
  tabId: null
};

/* ───────────────────────────────────────────
 * Research State
 * ─────────────────────────────────────────── */

const researchState = {
  running: false,
  aborted: false,
  query: "",
  tabId: null,
  sources: [],       // { name, url, status, statusText }
  results: [],       // completed source results
  currentSourceIndex: 0,
  reportId: null,
  visitedUrls: new Set(),
  abortController: null  // AbortController for instant cancellation
};

const RESEARCH_KEY = "webwright_research_reports";
const MAX_RESEARCH_REPORTS = 5;

/* ───────────────────────────────────────────
 * Provider Defaults
 * ─────────────────────────────────────────── */

const PROVIDER_DEFAULTS = {
  ollama_cloud: {
    endpoint: "https://ollama.com",
    apiKey: "",
    model: "kimi-k2.5:cloud",
    visionModel: "kimi-k2.5:cloud",
    researchModel: "gemini-3-flash-preview:cloud"
  },
  ollama_local: {
    endpoint: "http://localhost:11434",
    apiKey: "",
    model: "qwen2.5-coder:7b",
    visionModel: "llava:13b"
  },
  chatgpt: {
    endpoint: "https://api.openai.com",
    apiKey: "",
    model: "gpt-4o"
  },
  claude: {
    endpoint: "https://api.anthropic.com",
    apiKey: "",
    model: "claude-sonnet-4-20250514"
  },
  gemini: {
    endpoint: "https://generativelanguage.googleapis.com",
    apiKey: "",
    model: "gemini-2.0-flash"
  },
  deepseek: {
    endpoint: "https://api.deepseek.com",
    apiKey: "",
    model: "deepseek-chat"
  },
  grok: {
    endpoint: "https://api.x.ai",
    apiKey: "",
    model: "grok-3-mini"
  },
  custom: {
    endpoint: "",
    apiKey: "",
    model: "",
    visionModel: "",
    apiFormat: "openai"
  }
};

const DEFAULT_CONFIG = {
  provider: "ollama_cloud",
  providers: JSON.parse(JSON.stringify(PROVIDER_DEFAULTS)),
  maxSteps: 20,
  interStepDelay: 2000,
  llmTimeout: 60000,
  wallTimeout: 300000
};

/* ───────────────────────────────────────────
 * Chat History Queue — persists context across sessions
 * ─────────────────────────────────────────── */

const HISTORY_QUEUE_KEY = "chatHistoryQueue";
const HISTORY_QUEUE_MAX = 10; // Keep last K interactions

async function loadHistoryQueue() {
  try {
    const result = await chrome.storage.local.get(HISTORY_QUEUE_KEY);
    return result[HISTORY_QUEUE_KEY] || [];
  } catch { return []; }
}

async function pushHistoryQueue(entry) {
  const queue = await loadHistoryQueue();
  queue.push({
    type: entry.type,                          // "chat" or "agent"
    timestamp: new Date().toISOString(),
    userInput: (entry.userInput || "").slice(0, 100),
    summary: (entry.summary || "").slice(0, 150)
  });
  // FIFO: drop oldest when exceeding K
  const trimmed = queue.length > HISTORY_QUEUE_MAX ? queue.slice(queue.length - HISTORY_QUEUE_MAX) : queue;
  await chrome.storage.local.set({ [HISTORY_QUEUE_KEY]: trimmed });
}

/* ───────────────────────────────────────────
 * Workflow Recording & Replay State
 * ─────────────────────────────────────────── */

const WORKFLOWS_KEY = "savedWorkflows";
const PERSONAL_INFO_KEY = "webwright_personal_info";
const MAX_WORKFLOWS = 10;

const workflowState = {
  recording: false,
  recordingTabId: null,
  currentRecording: [],     // array of step objects being recorded
  replaying: false,
  replayWorkflowId: null,
  replayStep: 0,
  replayTotal: 0,
  replayTabId: null,
  replayAborted: false,
  replayPaused: false,
  replayParamValues: {}     // user-provided param overrides for replay
};

function isSameElement(fp1, fp2) {
  if (!fp1 || !fp2) return false;
  if (fp1.selectors && fp2.selectors) {
    if (fp1.selectors.id && fp2.selectors.id)
      return fp1.selectors.id === fp2.selectors.id;
    if (fp1.selectors.cssPath && fp2.selectors.cssPath)
      return fp1.selectors.cssPath === fp2.selectors.cssPath;
  }
  return false;
}

async function loadWorkflows() {
  try {
    const result = await chrome.storage.local.get(WORKFLOWS_KEY);
    return result[WORKFLOWS_KEY] || [];
  } catch { return []; }
}

async function saveWorkflow(workflow) {
  const workflows = await loadWorkflows();
  const idx = workflows.findIndex(w => w.id === workflow.id);
  if (idx >= 0) {
    workflows[idx] = workflow;
  } else {
    if (workflows.length >= MAX_WORKFLOWS) {
      workflows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      workflows.shift(); // remove oldest
    }
    workflows.push(workflow);
  }
  await chrome.storage.local.set({ [WORKFLOWS_KEY]: workflows });
}

async function deleteWorkflow(workflowId) {
  const workflows = await loadWorkflows();
  const filtered = workflows.filter(w => w.id !== workflowId);
  await chrome.storage.local.set({ [WORKFLOWS_KEY]: filtered });
}

/* ───────────────────────────────────────────
 * Config Load / Save
 * ─────────────────────────────────────────── */

async function loadConfig() {
  try {
    const result = await chrome.storage.local.get("agentConfig");
    const stored = result.agentConfig || {};
    const cfg = {
      provider: stored.provider || DEFAULT_CONFIG.provider,
      providers: { ...JSON.parse(JSON.stringify(PROVIDER_DEFAULTS)) },
      maxSteps: stored.maxSteps || DEFAULT_CONFIG.maxSteps,
      interStepDelay: stored.interStepDelay || DEFAULT_CONFIG.interStepDelay,
      llmTimeout: stored.llmTimeout || DEFAULT_CONFIG.llmTimeout,
      wallTimeout: stored.wallTimeout || DEFAULT_CONFIG.wallTimeout
    };
    if (stored.providers) {
      for (const key of Object.keys(cfg.providers)) {
        if (stored.providers[key]) {
          cfg.providers[key] = { ...cfg.providers[key], ...stored.providers[key] };
        }
      }
    }
    applyConfig(cfg);
    return cfg;
  } catch {
    applyConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(cfg) {
  await chrome.storage.local.set({ agentConfig: cfg });
  applyConfig(cfg);
}

function applyConfig(cfg) {
  agentState.provider = cfg.provider;
  agentState.maxSteps = cfg.maxSteps;
  agentState.interStepDelay = cfg.interStepDelay;
  agentState.llmTimeout = cfg.llmTimeout;
  agentState.wallTimeout = cfg.wallTimeout || 300000;

  const p = cfg.providers[cfg.provider] || {};
  agentState.endpoint = p.endpoint || "";
  agentState.apiKey = p.apiKey || "";
  agentState.model = p.model || "";

  // Providers with separate vision model: Ollama, and Custom with Ollama format
  if (cfg.provider === "ollama_cloud" || cfg.provider === "ollama_local" ||
      (cfg.provider === "custom" && p.apiFormat === "ollama")) {
    agentState.visionModel = p.visionModel || "";
  } else if (cfg.provider === "custom") {
    // Custom provider: use visionModel if set, otherwise fall back to primary model
    agentState.visionModel = p.visionModel || p.model || "";
  } else {
    agentState.visionModel = p.model || "";
  }
  // Store apiFormat for custom provider routing in callLLM
  agentState.apiFormat = p.apiFormat || "";
  // Research model — falls back to primary model if not set
  agentState.researchModel = p.researchModel || agentState.model;
}

/* ───────────────────────────────────────────
 * Messaging Helpers
 * ─────────────────────────────────────────── */

function sendToTab(tabId, message, frameId) {
  return new Promise((resolve, reject) => {
    const opts = frameId != null ? { frameId } : {};
    chrome.tabs.sendMessage(tabId, message, opts, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

// Wraps sendToTab with a single retry when Chrome's bfcache freezes the content script.
// bfcache kicks in after a client-side navigation (e.g. YouTube Subscribe → page update),
// closing the message channel mid-action. We wait, re-inject, then retry once.
const BFCACHE_ERR = "back/forward cache";
async function sendToTabRobust(tabId, message, frameId) {
  try {
    return await sendToTab(tabId, message, frameId);
  } catch (err) {
    if (err.message && err.message.includes(BFCACHE_ERR)) {
      broadcastLog({
        kind: "system", label: "bfcache Recovery",
        data: { msg: "Page moved to bfcache — waiting and re-injecting content script.", originalMessage: message.type }
      });
      await sleep(1200);
      const ok = await ensureContentScript(tabId);
      if (!ok) throw new Error("Content script unavailable after bfcache restoration.");
      return await sendToTab(tabId, message, frameId);
    }
    throw err;
  }
}

function broadcastStatus(status) {
  chrome.runtime.sendMessage({
    type: "AGENT_STATUS", ...status,
    step: agentState.step,
    maxSteps: agentState.maxSteps,
    running: agentState.running,
    history: agentState.history.slice(-5)
  }).catch(() => {});
}

function broadcastLog(entry) {
  const logEntry = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    step: agentState.step,
    ...entry
  };
  agentState.logs.push(logEntry);
  if (agentState.logs.length > 500) agentState.logs = agentState.logs.slice(-400);
  chrome.runtime.sendMessage({ type: "AGENT_LOG", log: logEntry }).catch(() => {});
}

/* ───────────────────────────────────────────
 * Content Script Injection + Google Fallback
 * ─────────────────────────────────────────── */

const BLOCKED_URL_RE = /^(chrome|chrome-extension|about|data|blob|devtools|view-source):/i;

function isBlockedUrl(url) {
  if (!url) return true;
  if (BLOCKED_URL_RE.test(url)) return true;
  if (url.includes("chrome.google.com/webstore")) return true;
  if (url.includes("chromewebstore.google.com")) return true;
  return false;
}

async function ensureContentScript(tabId) {
  try {
    const r = await sendToTab(tabId, { type: "PING" });
    if (r && r.alive) return true;
  } catch {}

  try {
    const tab = await chrome.tabs.get(tabId);
    if (isBlockedUrl(tab.url)) return false;
  } catch {}

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // allFrames: true so the content script runs in iframes too (e.g. YouTube live chat)
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content/content.js"] });
      await sleep(200);
      const r = await sendToTab(tabId, { type: "PING" });
      if (r && r.alive) return true;
    } catch (err) {
      if (attempt === 1) {
        console.error("[Agent] Injection failed after retries:", err);
        return false;
      }
      await sleep(800);
    }
  }
  return false;
}

async function ensureInjectableTab(tabId) {
  const ok = await ensureContentScript(tabId);
  if (ok) return tabId;

  broadcastLog({
    kind: "system",
    label: "Redirecting to Google",
    data: { reason: "Cannot inject script on current page. Navigating to google.com as fallback." }
  });

  await chrome.tabs.update(tabId, { url: "https://www.google.com" });
  await waitForTabLoad(tabId, 15000);
  await sleep(1500);

  const ok2 = await ensureContentScript(tabId);
  if (ok2) return tabId;

  throw new Error("Cannot inject content script even on google.com. Try reloading the extension.");
}

/* ───────────────────────────────────────────
 * Frame Discovery
 * ─────────────────────────────────────────── */

// Returns [{frameId, url}] for every frame in the tab that has the content script running.
// Uses scripting.executeScript with allFrames:true — each result carries its frameId.
async function discoverFrames(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => location.href
    });
    return results
      .filter(r => r.result != null)
      .map(r => ({ frameId: r.frameId, url: r.result }));
  } catch {
    return [{ frameId: 0, url: "" }];
  }
}

// Given pixel coords (x,y) in the main frame's CSS space, checks whether those
// coords land on an <iframe> element. If so, returns the iframe's Chrome frameId
// and the click position translated to the iframe's local coordinate space.
async function checkVisionInsideIframe(tabId, x, y) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (px, py) => {
        const el = document.elementFromPoint(px, py);
        if (!el || el.tagName !== "IFRAME") return null;
        const rect = el.getBoundingClientRect();
        return { src: el.src || "", relX: Math.round(px - rect.left), relY: Math.round(py - rect.top) };
      },
      args: [x, y]
    });
    const info = results[0] && results[0].result;
    if (!info || !info.src) return null;

    const frames = await discoverFrames(tabId);
    // Match by URL prefix (ignore query-string differences)
    const srcBase = info.src.split("?")[0];
    const frame = frames.find(f => f.frameId !== 0 && f.url.startsWith(srcBase));
    if (!frame) return null;

    return { frameId: frame.frameId, relX: info.relX, relY: info.relY };
  } catch {
    return null;
  }
}

/* ───────────────────────────────────────────
 * CDP Shadow DOM & Cross-Origin iframe Discovery
 * ─────────────────────────────────────────── */

const CDP_INTERACTIVE_TAGS = new Set([
  "A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "OPTION",
  "DETAILS", "SUMMARY", "VIDEO", "AUDIO"
]);

const CDP_INTERACTIVE_ROLES = new Set([
  "button", "link", "menuitem", "menuitemcheckbox", "menuitemradio",
  "tab", "checkbox", "radio", "textbox", "combobox", "searchbox",
  "option", "switch", "slider", "spinbutton", "listbox", "treeitem"
]);

function walkCDPNode(node, results, maxElements, inClosedShadow) {
  if (results.length >= maxElements) return;

  const tag = (node.nodeName || "").toUpperCase();

  // Parse attributes into key-value pairs
  const attrs = {};
  if (node.attributes) {
    for (let i = 0; i < node.attributes.length; i += 2) {
      if (i + 1 < node.attributes.length) {
        attrs[node.attributes[i]] = node.attributes[i + 1];
      }
    }
  }

  // Check if this element is interactive
  const isInteractive = CDP_INTERACTIVE_TAGS.has(tag) ||
    CDP_INTERACTIVE_ROLES.has(attrs.role) ||
    attrs.tabindex != null ||
    attrs.onclick != null ||
    (tag.includes("-") && (attrs["aria-label"] || attrs.role)); // custom web components

  if (isInteractive && inClosedShadow) {
    results.push({
      nodeId: node.nodeId,
      tag: tag.toLowerCase(),
      text: (attrs["aria-label"] || attrs.title || attrs.placeholder || attrs.value || "").slice(0, 80),
      ariaLabel: attrs["aria-label"] || null,
      role: attrs.role || null,
      type: attrs.type || null,
      href: attrs.href || null,
      placeholder: attrs.placeholder || null,
      name: attrs.name || null,
      htmlId: attrs.id || null,
      _cdpShadow: true
    });
  }

  // Recurse into children
  if (node.children) {
    for (const child of node.children) {
      walkCDPNode(child, results, maxElements, inClosedShadow);
    }
  }

  // Recurse into shadow roots
  if (node.shadowRoots) {
    for (const sr of node.shadowRoots) {
      const childInClosed = (sr.mode === "closed") || inClosedShadow;
      if (sr.children) {
        for (const child of sr.children) {
          walkCDPNode(child, results, maxElements, childInClosed);
        }
      }
    }
  }
}

async function cdpFindClosedShadowElements(tabId, maxElements) {
  maxElements = maxElements || 50;
  if (!debuggerState.attached || debuggerState.tabId !== tabId) return [];
  try {
    const { root } = await cdpSend("DOM.getDocument", { depth: -1, pierce: true });
    const results = [];
    walkCDPNode(root, results, maxElements, false);

    // Get bounding boxes for each found element
    const withBounds = [];
    for (const item of results) {
      try {
        const { model } = await cdpSend("DOM.getBoxModel", { nodeId: item.nodeId });
        if (model && model.content && model.content.length >= 4) {
          const x = model.content[0];
          const y = model.content[1];
          const w = model.content[2] - model.content[0];
          const h = model.content[5] - model.content[1];
          if (w > 1 && h > 1) {
            item.bounds = { x, y, w, h };
            item.inViewport = true; // We'll assume CDP elements are relevant
            item.selector = `[cdp-shadow-node="${item.nodeId}"]`; // Virtual selector for CDP elements
            withBounds.push(item);
          }
        }
      } catch { /* Element has no layout — skip */ }
    }

    return withBounds;
  } catch (err) {
    broadcastLog({ kind: "system", label: "CDP Shadow DOM Scan Failed", data: { error: err.message } });
    return [];
  }
}

async function cdpDiscoverCrossOriginFrames(tabId) {
  if (!debuggerState.attached || debuggerState.tabId !== tabId) return [];
  try {
    const { targetInfos } = await cdpSend("Target.getTargets");
    return (targetInfos || []).filter(t =>
      t.type === "iframe" && t.attached !== false
    ).map(t => ({
      targetId: t.targetId,
      url: t.url,
      title: t.title || ""
    }));
  } catch { return []; }
}

/* ───────────────────────────────────────────
 * Page Capture
 * ─────────────────────────────────────────── */

async function capturePageState(tabId) {
  const ok = await ensureContentScript(tabId);
  if (!ok) throw new Error("Cannot inject content script into this page.");

  const cap = 0; // use content script's default (300)
  const globalCap = 300;

  // Main frame (frameId 0) — required
  const mainResp = await sendToTabRobust(tabId, { type: "CAPTURE_STATE", capOverride: cap }, 0);
  if (!mainResp || !mainResp.success) throw new Error((mainResp && mainResp.error) || "Capture failed");
  const state = mainResp.state;

  // Sub-frames (iframes) — best-effort with per-frame timeout
  try {
    const frames = await discoverFrames(tabId);
    const subFrames = frames.filter(f => f.frameId !== 0);
    let capturedFrames = 0, skippedFrames = 0;
    for (const frame of subFrames) {
      try {
        const resp = await Promise.race([
          sendToTab(tabId, { type: "CAPTURE_STATE", capOverride: cap }, frame.frameId),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Frame timeout")), 2000))
        ]);
        if (resp && resp.success && resp.state && resp.state.elements.length > 0) {
          resp.state.elements.forEach(el => {
            el.frameId = frame.frameId;
            el.frameUrl = frame.url;
            el.id = frame.frameId + ":" + el.id;
            el.selector = el.selector.replace('[data-agent-id="', `[data-agent-id="${frame.frameId}:`);
          });
          state.elements.push(...resp.state.elements);
          capturedFrames++;
        } else { skippedFrames++; }
      } catch { skippedFrames++; }
    }
    if (subFrames.length > 0) {
      broadcastLog({ kind: "system", label: "Frames", data: { total: subFrames.length, captured: capturedFrames, skipped: skippedFrames } });
    }
    // Re-apply global element cap after merging
    if (state.elements.length > globalCap) state.elements = state.elements.slice(0, globalCap);
    state.totalCaptured = state.elements.length;
  } catch { /* frame discovery failed — main frame elements still usable */ }

  // CDP supplementary: find elements inside closed shadow DOMs
  if (debuggerState.attached && debuggerState.tabId === tabId) {
    try {
      const closedElements = await cdpFindClosedShadowElements(tabId, 50);
      if (closedElements.length > 0) {
        state.elements.push(...closedElements);
        broadcastLog({ kind: "system", label: "Closed Shadow Elements", data: { count: closedElements.length } });
      }
    } catch {}

    // Log cross-origin iframes (awareness only — not interactable yet)
    try {
      const crossOriginFrames = await cdpDiscoverCrossOriginFrames(tabId);
      if (crossOriginFrames.length > 0) {
        state._crossOriginFrames = crossOriginFrames;
        broadcastLog({ kind: "system", label: "Cross-Origin Frames", data: { count: crossOriginFrames.length, frames: crossOriginFrames.map(f => f.url) } });
      }
    } catch {}

    // Final cap after all sources
    if (state.elements.length > globalCap) state.elements = state.elements.slice(0, globalCap);
    state.totalCaptured = state.elements.length;
  }

  return state;
}

async function capturePageSummary(tabId) {
  const ok = await ensureContentScript(tabId);
  if (!ok) throw new Error("Cannot inject content script into this page.");
  const r = await sendToTabRobust(tabId, { type: "CAPTURE_SUMMARY" });
  if (!r || !r.success) throw new Error((r && r.error) || "Summary capture failed");
  return r.summary;
}

async function getPageInfo(tabId) {
  const ok = await ensureContentScript(tabId);
  if (!ok) throw new Error("Cannot inject content script.");
  const r = await sendToTabRobust(tabId, { type: "GET_PAGE_INFO" });
  if (!r || !r.success) throw new Error((r && r.error) || "Page info failed");
  return r.info;
}

// Element type → colour mapping for Set-of-Marks.
// Each category gets a distinct, high-contrast colour so the LLM can
// tell at a glance whether it is looking at a button, link, input, etc.
function somColorForElement(el) {
  const tag  = (el.tag  || "").toUpperCase();
  const role = (el.role || "").toLowerCase();
  const type = (el.type || "").toLowerCase();

  // Buttons / submit controls → red-orange
  if (tag === "BUTTON" || role === "button" || type === "button" || type === "submit" || type === "reset") return "#F04438";
  // Links / navigation → bright blue
  if (tag === "A" || role === "link") return "#1570EF";
  // Text inputs / textareas / search → green
  if (tag === "INPUT" && (type === "text" || type === "search" || type === "email" || type === "password" || type === "number" || type === "url" || type === "tel" || type === "" || !type)) return "#12B76A";
  if (tag === "TEXTAREA" || role === "textbox" || role === "searchbox") return "#12B76A";
  // Checkboxes / radios → amber
  if (type === "checkbox" || type === "radio") return "#F79009";
  // Selects / comboboxes → purple
  if (tag === "SELECT" || role === "combobox" || role === "listbox" || role === "option") return "#7A5AF8";
  // Custom components (web components with hyphens) → cyan
  if (tag.includes("-")) return "#0BA5EC";
  // Anything else clickable → grey-blue
  return "#475467";
}

// Set-of-Marks: draw numbered bounding boxes over each interactive element on the screenshot.
// Different element types get distinct colours so the LLM knows what each box represents.
// Returns annotated PNG as base64, or original base64 if anything fails.
async function annotateScreenshot(base64, elements, cssW, cssH) {
  try {
    // Screenshot is already at CSS viewport dimensions (downscaled before this call),
    // so element bounds (CSS pixels) map 1:1 to image pixels — no scaling needed.
    const canvas = new OffscreenCanvas(cssW, cssH);
    const ctx = canvas.getContext("2d");

    // Draw original screenshot
    const blob = await (await fetch("data:image/png;base64," + base64)).blob();
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, 0, 0, cssW, cssH);
    bitmap.close();

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const b = el.bounds;
      if (!b || b.w < 1 || b.h < 1) continue;

      const px = b.x;
      const py = b.y;
      const pw = Math.max(b.w, 4);
      const ph = Math.max(b.h, 4);
      const color = somColorForElement(el);
      const label = String(i + 1);
      const fontSize = 12;
      const badgeW = label.length * 8 + 8;
      const badgeH = 18;

      // Bounding box with slight transparency so content stays visible
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);

      // Semi-transparent fill so the element behind is still readable
      ctx.fillStyle = color + "22"; // ~13% opacity
      ctx.fillRect(px, py, pw, ph);

      // Badge: positioned above the element (or inside if no room above)
      const badgeY = py >= badgeH ? py - badgeH : py;
      ctx.fillStyle = color;
      ctx.fillRect(px, badgeY, badgeW, badgeH);
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillText(label, px + 4, badgeY + badgeH - 4);
    }

    const out = await canvas.convertToBlob({ type: "image/png" });
    const buf = await out.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  } catch (err) {
    console.warn("[SoM] Annotation failed:", err.message);
    return base64; // fallback to unannotated screenshot
  }
}

async function captureScreenshot(tabId) {
  try {
    const agentTab = await chrome.tabs.get(tabId);
    if (!agentTab || !agentTab.windowId) return null;

    // Save the user's currently active tab so we can restore it after capture.
    // Only needed if the agent tab isn't already active.
    let userTabId = null;
    const wasActive = agentTab.active;
    if (!wasActive) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: agentTab.windowId });
        if (activeTab) userTabId = activeTab.id;
      } catch { /* proceed anyway */ }
      await chrome.tabs.update(tabId, { active: true });
      await sleep(150); // brief pause for Chrome to paint the tab
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(agentTab.windowId, { format: "png", quality: 85 });

    // Immediately restore the user's tab
    if (userTabId != null && !wasActive) {
      try { await chrome.tabs.update(userTabId, { active: true }); }
      catch { /* user tab may have been closed — that's fine */ }
    }

    return dataUrl.replace(/^data:image\/\w+;base64,/, "");
  } catch (err) {
    console.warn("[Agent] Screenshot failed:", err.message);
    return null;
  }
}

// Downscale a base64 PNG to target dimensions using OffscreenCanvas.
// Used to match screenshot resolution to CSS viewport pixels so the LLM's
// coordinate space equals the browser's CSS pixel space — no scaling needed.
async function downscaleScreenshot(base64, targetW, targetH) {
  try {
    const blob = await (await fetch("data:image/png;base64," + base64)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();
    const out = await canvas.convertToBlob({ type: "image/png" });
    const buf = await out.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  } catch (err) {
    console.warn("[Agent] Downscale failed:", err.message);
    return base64; // fallback to original
  }
}

/* ═══════════════════════════════════════════
 * PROMPT BUILDERS
 * ═══════════════════════════════════════════ */

const RECENT_HISTORY_COUNT = 4;

function summarizeHistoryEntry(h) {
  let line = `Step ${h.step}: ${h.action}`;
  if (h.description) line += ` "${h.description.slice(0, 30)}"`;
  else if (h.value) line += ` "${h.value.slice(0, 30)}"`;
  else if (h.url) line += ` → ${h.url}`;
  line += ` → ${h.result}`;
  if (h.error) line += ` (${h.error.slice(0, 40)})`;
  if (h.pageUrl) {
    try { line += ` [${new URL(h.pageUrl).pathname}]`; } catch {}
  }
  return line;
}

function formatHistoryForPrompt(history, formatter) {
  if (history.length === 0) return "";
  if (history.length <= RECENT_HISTORY_COUNT) {
    let block = `\n\nACTION HISTORY (${history.length} steps — DO NOT repeat failed or looping actions):`;
    for (const h of history) block += "\n" + formatter(h);
    return block;
  }
  const older = history.slice(0, -RECENT_HISTORY_COUNT);
  const recent = history.slice(-RECENT_HISTORY_COUNT);
  let block = `\n\nACTION HISTORY SUMMARY (steps 1-${older[older.length - 1].step}):`;
  for (const h of older) block += "\n  " + summarizeHistoryEntry(h);
  block += `\n\nRECENT ACTIONS (last ${RECENT_HISTORY_COUNT} — DO NOT repeat failed or looping actions):`;
  for (const h of recent) block += "\n" + formatter(h);
  return block;
}

function rankElements(elements, goal, viewportHeight) {
  const goalLower = (goal || "").toLowerCase();
  const goalWords = goalLower.split(/\s+/).filter(w => w.length > 2);
  const vpCenter = (viewportHeight || 800) / 2;

  return elements.map(el => {
    let score = 0;
    // Size: larger elements are more prominent
    if (el.bounds) {
      const area = el.bounds.w * el.bounds.h;
      if (area > 10000) score += 3;
      else if (area > 2000) score += 2;
      else if (area > 500) score += 1;
    }
    // Viewport center proximity
    if (el.inViewport && el.bounds) {
      const centerY = el.bounds.y + el.bounds.h / 2;
      if (Math.abs(centerY - vpCenter) < vpCenter * 0.3) score += 2;
    }
    // Interactive tag priority
    const tag = (el.tag || "").toLowerCase();
    if (tag === "button" || tag === "input" || tag === "textarea" || tag === "select") score += 2;
    else if (tag === "a") score += 1;
    // Goal text relevance
    if (goalWords.length > 0) {
      const elText = ((el.text || "") + " " + (el.ariaLabel || "") + " " + (el.placeholder || "")).toLowerCase();
      for (const w of goalWords) {
        if (elText.includes(w)) score += 3;
      }
    }
    // In viewport bonus
    if (el.inViewport) score += 2;

    el._rs = score;
    return el;
  }).sort((a, b) => b._rs - a._rs);
}

async function getPersonalInfoBlock(goal) {
  const lower = (goal || "").toLowerCase();
  const kw = ["fill", "form", "complete", "enter", "personal", "info", "details", "sign up", "signup",
    "register", "registration", "application", "apply", "profile", "checkout", "booking",
    "reservation", "my name", "my address", "my info", "my detail"];
  if (!kw.some(k => lower.includes(k))) return "";
  try {
    const r = await chrome.storage.local.get(PERSONAL_INFO_KEY);
    const info = r[PERSONAL_INFO_KEY];
    if (!info) return "";
    let parts = [];
    if (info.name) parts.push("Name: " + info.name);
    if (info.age) parts.push("Age: " + info.age);
    if (info.sex) parts.push("Sex: " + info.sex);
    if (info.fatherName) parts.push("Father's Name: " + info.fatherName);
    if (info.motherName) parts.push("Mother's Name: " + info.motherName);
    if (info.address) parts.push("Address: " + info.address);
    if (info.customFields) info.customFields.forEach(cf => { if (cf.label && cf.value) parts.push(cf.label + ": " + cf.value); });
    if (!parts.length) return "";
    return "\n\nUSER'S PERSONAL INFO (use this data to fill form fields — match field labels to the info below):\n" + parts.join("\n");
  } catch { return ""; }
}

function buildDOMPrompt(goal, pageState, history, chatContext, lastThinking, personalInfoBlock) {
  const sys = `You are a browser automation agent. You receive interactive elements from the current page and a goal. Decide the single next action.

RULES:
- Respond with a strict JSON object ONLY — no explanation, markdown, or code fences.
- One action per response.
- STOPPING: Declare "done" immediately when evidence shows the goal is achieved (confirmation/success page, changed button text, URL containing "confirm"/"success"/"thank"/"complete"/"done"/"receipt"/"booking", requested content visible, or stateAfter showing the change happened). Do NOT over-act after completion — it wastes steps and can undo work.
- If an action result says "success", that only means the click/keystroke fired — wait one step to see the page response, then declare "done" if evidence is present.
- If stuck or goal impossible, use "error".
- PAYMENTS & PASSWORDS: If you encounter a payment form (credit card, UPI, billing address) or a password / PIN entry field, STOP immediately. Use the "error" action: set "reason" to explain you reached a payment or password step, "completed" to what you accomplished so far, and "manual_steps" to the exact steps the user must take to finish. NEVER fill in payment details or passwords.
- LOOP/REPEAT: Review your action history. Never repeat an action on the same element unless the page visibly changed (different URL, new stateAfter, new elements). Same action 2+ times with no progress = loop — try a completely different approach. Never re-type a value you already submitted — an empty field after submit means it was sent successfully.
- TRUST CURRENT STATE: The "Current URL", "Page Title", and "Interactive Elements" below reflect the page RIGHT NOW. Ignore any conflicting URLs or state from previous reasoning or older history entries — pages change after navigation.
- Target elements using "id" from the Interactive Elements list ONLY. Never invent or guess ids.
- Prefer in-viewport elements (inViewport: true). Scroll down if target is below the fold.
- Use "role", "ariaLabel", "dataUrl", "dataHref" fields to understand element purpose.
- Search bars: set "then_submit": true.
- Native <select> (tag: "SELECT", options listed): use "select" action with option text. Do NOT click a SELECT. If options show "optionsTruncated", the full list is longer — try "select" with your best guess for the value (e.g. country name) since all options are matched server-side even if not shown.
- Custom dropdowns (styled divs/buttons): click trigger to open, then click option in next step. If the option list is scrollable, use scroll or ArrowDown to reveal more options.
- Date pickers: click input to open calendar, click day. Wrong month? Click prev/next arrow first.
- "key" presses: Escape=close popups, Tab=move fields, ArrowDown/Up=navigate lists, Enter=confirm.
- "hover" to open hover-triggered menus. Elements with "hidden": true need hover on parent first.

AVAILABLE ACTIONS:
{ "action": "navigate", "url": "<full_url>" }
{ "action": "click", "id": <element_id>, "description": "<what you're clicking>" }
{ "action": "type", "id": <element_id>, "value": "<text to type>", "then_submit": <true|false> }
{ "action": "select", "id": <element_id>, "value": "<option text or value>" }
{ "action": "key", "id": <element_id_or_null>, "key": "<Tab|Enter|Escape|ArrowDown|ArrowUp|Backspace>" }
{ "action": "hover", "id": <element_id>, "description": "<why hovering>" }
{ "action": "scroll", "direction": "<up|down>", "amount": <pixels> }
{ "action": "wait", "ms": <milliseconds>, "reason": "<why waiting>" }
{ "action": "done", "summary": "<bullet-point list of what was accomplished, one line per bullet starting with '- '>", "remaining": "<what the user still needs to do manually, if anything — omit if fully complete>" }
{ "action": "error", "reason": "<why you cannot proceed>", "completed": "<what you did accomplish before getting stuck>", "manual_steps": "<what the user should do to finish the task>" }
{ "action": "plan", "steps": [action1, action2, action3], "reasoning": "<why these can be batched>" }

PLAN RULES:
- You may optionally return a "plan" with 2-3 sequential actions when the next steps are obvious and low-risk (e.g., navigate then click, or type then submit).
- Each step in the plan must be a valid action object from the list above (not "plan", "done", or "error").
- Max 3 steps per plan. If any step fails, the plan stops and normal single-step mode resumes.
- Only use "plan" when you are highly confident about the sequence. For uncertain situations, return a single action.`;

  let user = `Goal: "${goal}"
Current URL: ${pageState.url}
Page Title: ${pageState.title}
Scroll Position: ${pageState.scrollY}px / ${pageState.documentHeight}px total
Viewport Height: ${pageState.viewportHeight}px
Elements Found: ${pageState.totalCaptured || pageState.elements.length} total (${pageState.inViewport || "?"} in viewport)
Interactive Elements:
${(() => {
    const MAX_DOM_ELEMENTS = 300;
    const ranked = rankElements(pageState.elements, goal, pageState.viewportHeight);
    const capped = ranked.slice(0, MAX_DOM_ELEMENTS);
    const json = JSON.stringify(capped.map(el => {
      const s = { id: el.id, tag: el.tag };
      if (el.text) s.text = el.text;
      if (el.type) s.type = el.type;
      if (el.href) s.href = el.href;
      if (el.placeholder) s.placeholder = el.placeholder;
      if (el.value) s.value = el.value;
      if (el.ariaLabel) s.ariaLabel = el.ariaLabel;
      if (el.role) s.role = el.role;
      if (el.dataUrl) s.dataUrl = el.dataUrl;
      if (el.dataHref) s.dataHref = el.dataHref;
      if (el.options) s.options = el.options;
      if (el.optionsTruncated) s.optionsTruncated = el.optionsTruncated;
      if (el.disabled) s.disabled = true;
      if (el.hidden) s.hidden = true;
      s.inViewport = el.inViewport;
      return s;
    }), null, 0);
    const omitted = ranked.length - capped.length;
    return omitted > 0 ? json + `\n(${omitted} lower-relevance elements omitted. Scroll or try a different approach if target not listed.)` : json;
  })()}`;

  // Add recent chat context so the agent can resolve references like "it", "that product", etc.
  if (chatContext && chatContext.length > 0) {
    user += `\n\nRECENT CHAT CONTEXT (the user was chatting about these topics before invoking the agent — use this to resolve references like "it", "that", "the same thing", etc.):`;
    for (const msg of chatContext) {
      user += `\n${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`;
    }
  }

  user += formatHistoryForPrompt(history, function(h) {
    let line = `Step ${h.step} [${h.result}] ${h.action}`;
    if (h.id != null) line += ` on element #${h.id}`;
    else if (h.selector) line += ` on ${h.selector}`;
    if (h.description) line += ` — ${h.description}`;
    if (h.value) line += ` value="${h.value}"`;
    if (h.url) line += ` → ${h.url}`;
    if (h.direction) line += ` ${h.direction}`;
    if (h.clickedTag) line += ` (hit: <${h.clickedTag}>`;
    if (h.clickedText) line += ` "${h.clickedText.slice(0, 40)}"`;
    if (h.clickedTag) line += `)`;
    if (h.error) line += ` ERROR: ${h.error}`;
    if (h.stateAfter) line += ` stateAfter: ${JSON.stringify(h.stateAfter)}`;
    if (h.pageUrl) line += ` [page: ${h.pageUrl}]`;
    if (h.mode === "vision") line += ` [vision mode]`;
    if (h.mode === "raw_vision") line += ` [raw vision mode]`;
    if (h.visualIssue) line += ` VISUAL CHECK FAILED: ${h.visualIssue}`;
    return line;
  });

  // Inject previous step's reasoning — strip URLs to prevent confusion with fresh page state
  if (lastThinking) {
    const stripped = lastThinking.replace(/https?:\/\/[^\s)"\]]+/g, "[URL]");
    const sentences = stripped.split(/(?<=[.!?])\s+/).filter(Boolean);
    const tail = sentences.slice(-3).join(" ");
    const capped = tail.length > 400 ? tail.slice(-400) : tail;
    user += `\n\nYOUR PREVIOUS REASONING (for continuity only — trust Current URL and Interactive Elements above, NOT URLs in this reasoning):\n${capped}`;
  }

  // Nudge LLM to check for completion
  const urlLower = (pageState.url || "").toLowerCase();
  const titleLower = (pageState.title || "").toLowerCase();
  const doneHints = ["confirm", "success", "thank", "complete", "done", "receipt", "booking", "order-placed", "submitted"];
  const hintMatch = doneHints.some(h => urlLower.includes(h) || titleLower.includes(h));
  if (hintMatch && history.length > 0) {
    user += `\n\n⚠️ The current URL or page title suggests the goal may already be achieved. If so, respond with {"action":"done","summary":"<what was accomplished>"}. Do NOT continue acting if the goal is complete.`;
  }

  // YouTube-specific: comment boxes are two-step
  if ((pageState.url || "").includes("youtube.com")) {
    user += `\n\nYOUTUBE NOTE: Comment boxes are two-step — click placeholder to expand, then type into the revealed input. Never use then_submit on comments or contenteditable boxes — click the post button separately.`;
  }

  // If starting from google.com on step 1, tell the agent to navigate directly
  if ((pageState.url || "").includes("google.com") && history.length === 0) {
    user += `\n\nIMPORTANT: You are on a starting page. Use the "navigate" action to go DIRECTLY to the most relevant website URL for the goal. Do NOT type into Google search — navigate to the actual site (e.g. weather.com, gmail.com, amazon.com, etc.).`;
  }

  if (personalInfoBlock) user += personalInfoBlock;

  user += `\n\nWhat is the single next action? Respond with JSON only.`;

  return [{ role: "system", content: sys }, { role: "user", content: user }];
}

function buildVisionPrompt(goal, pageInfo, history, escalationReason, somElements, personalInfoBlock) {
  // Screenshot is downscaled to CSS viewport dimensions, so coordinates = CSS pixels.
  const screenshotW = pageInfo.viewportWidth;
  const screenshotH = pageInfo.viewportHeight;
  const hasSoM = somElements && somElements.length > 0;

  const sys = `You are a visual browser automation agent analyzing a screenshot to decide the next action.

${escalationReason ? "REASON FOR ESCALATION: " + escalationReason : "MODE: Vision-assisted — the page has many elements so a screenshot helps you navigate."}

RULES:
- Respond with a strict JSON object ONLY — no explanation, markdown, or code fences.
- One action per response.
${hasSoM ? `- The screenshot has NUMBERED BOXES with colour-coded borders:
  🔴 Red = Buttons  🔵 Blue = Links  🟢 Green = Inputs/Textareas  🟡 Amber = Checkboxes/Radios  🟣 Purple = Selects  🩵 Cyan = Custom components
- PREFER "element": <number> when target is in the numbered list.
- If target is visible but NOT numbered, use raw x/y pixel coordinates as fallback.
- NEVER return "error" just because an element is unnumbered — use coordinates instead.
${somElements && somElements.length > 100 ? `- Many numbered elements present. Scan the full list — target is very likely here.` : ""}` : `- Return EXACT pixel coordinates (x, y) of the CENTER of the target element for click/type actions.
- Coordinates must be within the screenshot dimensions.`}
- STOP immediately when screenshot shows goal achieved (success/confirmation page, changed text, requested content visible). Do not over-act.
- If same coordinates/element clicked 2+ times with no visible change, you're in a loop — try a different element or approach.
- If truly stuck, use "error".
- PAYMENTS & PASSWORDS: If you encounter a payment form (credit card, UPI, billing address) or a password / PIN entry field, STOP immediately. Use the "error" action: set "reason" to explain you reached a payment or password step, "completed" to what you accomplished so far, and "manual_steps" to the exact steps the user must take to finish. NEVER fill in payment details or passwords.
- Never return a "selector" field.

SCREENSHOT SIZE: ${screenshotW}px wide × ${screenshotH}px tall
${hasSoM ? "" : `Coordinates: 0 ≤ x ≤ ${screenshotW}, 0 ≤ y ≤ ${screenshotH}`}
AVAILABLE ACTIONS:
${hasSoM ? `{ "action": "click", "element": <number>, "description": "<what you are clicking>" }
{ "action": "click", "x": <pixel_x>, "y": <pixel_y>, "description": "<unnumbered target>" }
{ "action": "type", "element": <number>, "value": "<text>", "then_submit": <true|false>, "description": "<field name>" }
{ "action": "type", "x": <pixel_x>, "y": <pixel_y>, "value": "<text>", "then_submit": <true|false>, "description": "<unnumbered field>" }` : `{ "action": "click", "x": <pixel_x>, "y": <pixel_y>, "description": "<what you see and are clicking>" }
{ "action": "type", "x": <pixel_x>, "y": <pixel_y>, "value": "<text>", "then_submit": <true|false>, "description": "<what field>" }`}
{ "action": "key", "x": <pixel_x_or_null>, "y": <pixel_y_or_null>, "key": "<Tab|Enter|Escape|ArrowDown|ArrowUp|Backspace>" }
{ "action": "hover", "x": <pixel_x>, "y": <pixel_y>, "description": "<why hovering>" }
{ "action": "scroll", "direction": "<up|down>", "amount": <pixels> }
{ "action": "navigate", "url": "<full_url>" }
{ "action": "wait", "ms": <milliseconds>, "reason": "<why>" }
{ "action": "done", "summary": "<bullet-point list of what was accomplished, one line per bullet starting with '- '>", "remaining": "<what the user still needs to do manually, if anything — omit if fully complete>" }
{ "action": "error", "reason": "<why you cannot proceed>", "completed": "<what you did accomplish before getting stuck>", "manual_steps": "<what the user should do to finish the task>" }`;

  let user = `Goal: "${goal}"
Current URL: ${pageInfo.url}
Page Title: ${pageInfo.title}
Screenshot: ${screenshotW}px × ${screenshotH}px
Scroll: ${pageInfo.scrollY}px / ${pageInfo.documentHeight}px`;

  if (hasSoM) {
    user += `\n\nNUMBERED ELEMENTS (boxes drawn on screenshot):\n` + somElements.map((el, i) => {
      const parts = [`${i + 1}.`, el.tag];
      if (el.text)        parts.push(`"${el.text.slice(0, 60)}"`);
      if (el.ariaLabel && !el.text) parts.push(`aria:"${el.ariaLabel.slice(0, 40)}"`);
      if (el.placeholder) parts.push(`placeholder:"${el.placeholder}"`);
      if (el.type)        parts.push(`type=${el.type}`);
      if (el.role)        parts.push(`role=${el.role}`);
      if (el.options) {
        parts.push(`options:[${el.options.map(o => o.text).join(",")}]`);
        if (el.optionsTruncated) parts.push(`(${el.optionsTruncated} total, showing first 50)`);
      }
      if (el.hidden)      parts.push("[hidden]");
      if (!el.inViewport) parts.push("[off-screen]");
      return parts.join(" ");
    }).join("\n");
  }

  user += formatHistoryForPrompt(history, function(h) {
    let line = `Step ${h.step} [${h.result}] ${h.action}`;
    if (h.description) line += ` — ${h.description}`;
    if (h.x != null) line += ` at (${h.x},${h.y})`;
    if (h.value) line += ` value="${h.value}"`;
    if (h.url) line += ` → ${h.url}`;
    if (h.clickedTag) line += ` (hit: <${h.clickedTag}>`;
    if (h.clickedText) line += ` "${h.clickedText.slice(0, 40)}"`;
    if (h.clickedTag) line += `)`;
    if (h.error) line += ` ERROR: ${h.error}`;
    if (h.pageUrl) line += ` [page: ${h.pageUrl}]`;
    if (h.mode) line += ` [${h.mode}]`;
    return line;
  });

  // Nudge LLM to check for completion
  const urlLower = (pageInfo.url || "").toLowerCase();
  const titleLower = (pageInfo.title || "").toLowerCase();
  const doneHints = ["confirm", "success", "thank", "complete", "done", "receipt", "booking", "order-placed", "submitted"];
  const hintMatch = doneHints.some(h => urlLower.includes(h) || titleLower.includes(h));
  if (hintMatch && history.length > 0) {
    user += `\n\n⚠️ The current URL or page title suggests the goal may already be achieved. If so, respond with {"action":"done","summary":"<what was accomplished>"}. Do NOT continue acting if the goal is complete.`;
  }

  if (personalInfoBlock) user += personalInfoBlock;

  user += hasSoM
    ? `\n\nLook at the numbered boxes on the screenshot. Use "element": <number> to target elements. Return JSON only.`
    : `\n\nLook at the screenshot carefully. What is the single next action? Return JSON with pixel coordinates for click/type.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: user }
  ];
}

/* ───────────────────────────────────────────
 * Chat Mode Prompt Builder
 * ─────────────────────────────────────────── */

function buildChatSystemPrompt(summary, historyQueue) {
  let historySection = "";
  if (historyQueue && historyQueue.length > 0) {
    historySection = "\n\nRECENT CONVERSATION HISTORY (for context — the user may reference these):\n" +
      historyQueue.map(function(h) {
        return "- [" + h.type + "] User asked: \"" + h.userInput + "\" → " + h.summary;
      }).join("\n");
  }

  return `You are a helpful AI assistant embedded in a browser extension. The user is viewing a web page and wants to chat about it.

PAGE CONTEXT:
URL: ${summary.url}
Title: ${summary.title}

${summary.text}
${historySection}

RULES:
- Answer questions about the page content above.
- If the user asks about something not on the page, use your general knowledge.
- If the user references a previous interaction from the history above, use that context.
- IMPORTANT: This extension has an "Agent mode" that can interact with the browser (click buttons, fill forms, navigate to sites, search the web, book things, etc.). If the user asks you to DO something that requires browser interaction — like searching, clicking, navigating, booking, filling forms, checking email, liking a video, adding to cart, etc. — politely suggest they use Agent mode instead. Say something like: "That sounds like something I'd need to interact with the browser for! Try using Agent mode (the bolt button or Ctrl+Enter) and I can handle that for you." Do NOT attempt to simulate or describe browser actions step-by-step in chat.
- Use PLAIN TEXT only. No markdown tables, no headings (#), no horizontal rules.
- You may use **bold** and *italic* for emphasis, and bullet points (- item) for short lists.
- Keep responses conversational and easy to read.
- Be direct and helpful. If you don't know something, say so honestly.`;
}

/* ───────────────────────────────────────────
 * Intent Classification (Chat vs Agent)
 * ─────────────────────────────────────────── */

// Massive action keyword set — if ANY of these appear in the first 4 words, it's agent mode.
// Everything else goes to LLM for classification (no chat keywords at all).
const ACTION_KEYWORDS = new Set([
  // Navigation
  "go", "navigate", "open", "visit", "browse", "load", "redirect", "goto",
  // Search & find
  "search", "find", "lookup", "locate", "discover", "explore", "query", "google",
  // Click / tap
  "click", "tap", "press", "hit", "select", "choose", "pick", "toggle",
  // Type / input
  "type", "enter", "input", "fill", "write", "submit", "send", "post",
  // Forms & transactions
  "book", "reserve", "schedule", "order", "purchase", "buy", "checkout",
  "register", "signup", "login", "signin", "logout", "signout",
  // Account actions
  "subscribe", "unsubscribe", "follow", "unfollow", "like", "dislike",
  "favorite", "unfavorite", "star", "unstar", "save", "unsave",
  "block", "unblock", "mute", "unmute", "report", "flag",
  // Media
  "play", "pause", "stop", "skip", "rewind", "forward", "seek",
  "download", "upload", "stream", "record", "capture", "screenshot",
  // Page manipulation
  "scroll", "refresh", "reload", "close", "minimize", "maximize",
  "resize", "zoom", "expand", "collapse", "hide", "show", "reveal",
  // CRUD
  "create", "make", "add", "new", "insert", "append",
  "edit", "modify", "change", "update", "rename", "replace",
  "delete", "remove", "clear", "erase", "destroy", "trash",
  "copy", "duplicate", "clone", "move", "drag", "drop", "transfer",
  // Settings
  "configure", "setup", "enable", "disable", "activate", "deactivate",
  "turn", "switch", "adjust", "customize", "personalize",
  // Communication
  "share", "reply", "respond", "compose", "draft",
  "message", "email", "text", "call", "contact", "invite",
  // Organization
  "pin", "unpin", "archive", "unarchive", "sort", "filter", "organize",
  "tag", "label", "categorize", "group", "merge", "split",
  // Approval / management
  "check", "verify", "confirm", "approve", "reject", "deny",
  "accept", "decline", "cancel", "revoke", "undo", "redo",
  // Install / sync
  "install", "uninstall", "upgrade", "downgrade",
  "connect", "disconnect", "sync", "import", "export", "backup",
  // E-commerce
  "cart", "wishlist", "compare", "review", "rate",
  "apply", "redeem", "claim", "use",
  // Navigation specific
  "back", "next", "previous", "first", "last", "top", "bottom",
  "home", "menu", "tab",
  // Misc actions
  "scan", "print", "translate", "convert", "generate", "run",
  "start", "launch", "execute", "trigger", "automate", "scrape",
  "extract", "monitor", "watch", "track", "subscribe",
  "pay", "tip", "donate", "bid", "sell", "list", "ship",
  "reset", "restore", "recover", "revert",
]);

// Multi-word action phrases that need regex matching
const MULTI_WORD_ACTIONS = [
  /\bsign\s*(up|in|out)\b/i,
  /\blog\s*(in|out|off)\b/i,
  /\bturn\s*(on|off)\b/i,
  /\bset\s*up\b/i,
  /\badd\s+to\b/i,
  /\bgo\s+to\b/i,
  /\bcheck\s+(my|the|this|those|that)\b/i,
  /\bin\s+(a\s+)?new\s+tab\b/i,
  /\bbackground\s+tab\b/i,
  /\bsearch\s+for\b/i,
  /\bfind\s+(me|and|the|a)\b/i,
  /\blook\s+up\b/i,
  /\bpick\s+up\b/i,
  /\bfill\s+(in|out)\b/i,
  /\bopt\s+(in|out)\b/i,
  /\bsign\s+me\b/i,
  /\bget\s+(me|my|the|a)\b/i,
  /\bshow\s+(me|my|the)\b/i,
  /\bbring\s+up\b/i,
  /\bpull\s+up\b/i,
];

/**
 * Returns the effective API format for the current provider.
 * "ollama" | "openai" | "claude" | "gemini"
 */
function getApiFormat(provider) {
  if (provider === "ollama_cloud" || provider === "ollama_local") return "ollama";
  if (provider === "chatgpt" || provider === "deepseek" || provider === "grok") return "openai";
  if (provider === "claude") return "claude";
  if (provider === "gemini") return "gemini";
  if (provider === "custom") return agentState.apiFormat || "openai";
  return "openai"; // safe default
}

function classifyIntent(text) {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // Check first 4 words for action keywords (O(1) Set lookup)
  for (let i = 0; i < Math.min(words.length, 4); i++) {
    const word = words[i].replace(/[^a-z]/g, "");
    if (word && ACTION_KEYWORDS.has(word)) return { intent: "agent", confident: true };
  }

  // Check multi-word action patterns anywhere in the text
  for (const p of MULTI_WORD_ACTIONS) {
    if (p.test(lower)) return { intent: "agent", confident: true };
  }

  // No keyword match — let LLM decide (no chat keywords, no question-mark heuristic)
  return { intent: "agent", confident: false };
}

/**
 * LLM-based intent classification — only called when pattern matching isn't confident.
 * Makes a minimal, silent API call (no activity log pollution).
 */
async function classifyIntentViaLLM(text) {
  await loadConfig();
  const provider = agentState.provider;
  const endpoint = agentState.endpoint.replace(/\/$/, "");
  const apiKey = agentState.apiKey;
  const model = agentState.model;

  const sysPrompt = 'Classify the user\'s intent as either "chat" or "agent".\n- "chat": asking a question, wanting information, having a conversation, greeting, or anything that does NOT require interacting with a browser.\n- "agent": wants to perform a browser action — navigate to a site, click something, fill a form, check email, search the web, etc.\nIf you are unsure, default to "chat".\nRespond with ONLY the single word "chat" or "agent".';

  let url, headers, body;

  const fmt = getApiFormat(provider);

  if (fmt === "ollama") {
    url = endpoint + "/api/chat";
    headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
    body = JSON.stringify({
      model, stream: false,
      messages: [{ role: "system", content: sysPrompt }, { role: "user", content: text }],
      options: { temperature: 0, num_predict: 10 }
    });
  } else if (fmt === "openai") {
    url = endpoint + "/v1/chat/completions";
    headers = { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey };
    body = JSON.stringify({
      model, temperature: 0, max_tokens: 10,
      messages: [{ role: "system", content: sysPrompt }, { role: "user", content: text }]
    });
  } else if (fmt === "claude") {
    url = endpoint + "/v1/messages";
    headers = { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    body = JSON.stringify({
      model, system: sysPrompt, max_tokens: 10, temperature: 0,
      messages: [{ role: "user", content: text }]
    });
  } else if (fmt === "gemini") {
    url = endpoint + "/v1beta/models/" + model + ":generateContent?key=" + apiKey;
    headers = { "Content-Type": "application/json" };
    body = JSON.stringify({
      contents: [{ parts: [{ text: sysPrompt + "\n\nUser: " + text }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 10 }
    });
  } else {
    return "agent";
  }

  try {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    clearTimeout(timerId);
    if (!resp.ok) return "agent";
    const raw = await resp.json();

    let content = "";
    if (fmt === "ollama") {
      content = (raw.message && raw.message.content) || "";
    } else if (fmt === "openai") {
      content = (raw.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.content) || "";
    } else if (fmt === "claude") {
      content = (raw.content && Array.isArray(raw.content) && raw.content[0] && raw.content[0].text) || "";
    } else if (fmt === "gemini") {
      content = (raw.candidates && raw.candidates[0] && raw.candidates[0].content && raw.candidates[0].content.parts && raw.candidates[0].content.parts[0] && raw.candidates[0].content.parts[0].text) || "";
    }

    content = content.trim().toLowerCase();
    if (content.includes("chat")) return "chat";
    return "agent";
  } catch {
    return "agent"; // default on failure
  }
}

/* ═══════════════════════════════════════════
 * MULTI-PROVIDER LLM CALL
 * ═══════════════════════════════════════════ */

async function callLLM(messages, model, label, screenshotBase64, options) {
  options = options || {};
  const forceJson = options.forceJson !== false; // default true
  const provider = agentState.provider;
  const endpoint = agentState.endpoint.replace(/\/$/, "");
  const apiKey = agentState.apiKey;
  const timeout = options.timeout || agentState.llmTimeout;

  broadcastLog({
    kind: "ollama_request",
    label: `LLM Request [${label}]`,
    data: {
      provider, model, timeout_ms: timeout,
      messages_count: messages.length,
      has_images: !!screenshotBase64,
      prompt_preview: (messages[messages.length - 1] ? messages[messages.length - 1].content || "" : "").slice(0, 500) + "…"
    }
  });

  let url, headers, body;
  const fmt = getApiFormat(provider);

  if (fmt === "ollama") {
    url = endpoint + "/api/chat";
    headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = "Bearer " + apiKey;

    const ollamaMsgs = messages.map((m, i) => {
      const msg = { role: m.role, content: m.content };
      if (i === messages.length - 1 && screenshotBase64) {
        msg.images = [screenshotBase64];
      }
      return msg;
    });

    const bodyObj = {
      model: model,
      messages: ollamaMsgs,
      stream: false,
      options: { temperature: 0.1, num_predict: 4096 }
    };
    if (forceJson) bodyObj.format = "json";
    body = JSON.stringify(bodyObj);

  } else if (fmt === "openai") {
    url = endpoint + "/v1/chat/completions";
    headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    };

    const gptMsgs = messages.map((m, i) => {
      if (i === messages.length - 1 && screenshotBase64) {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: "data:image/png;base64," + screenshotBase64, detail: "auto" } }
          ]
        };
      }
      return { role: m.role, content: m.content };
    });

    const bodyObj = {
      model: model,
      messages: gptMsgs,
      temperature: 0.1,
      max_tokens: 4096
    };
    if (forceJson) bodyObj.response_format = { type: "json_object" };
    body = JSON.stringify(bodyObj);

  } else if (fmt === "claude") {
    url = endpoint + "/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    };

    const systemMsg = messages.find(m => m.role === "system");
    const nonSystem = messages.filter(m => m.role !== "system");

    const claudeMsgs = nonSystem.map((m, i) => {
      if (i === nonSystem.length - 1 && screenshotBase64) {
        return {
          role: m.role,
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: screenshotBase64 } },
            { type: "text", text: m.content }
          ]
        };
      }
      return { role: m.role, content: m.content };
    });

    let sysContent = systemMsg ? systemMsg.content : "";
    if (forceJson) sysContent += "\n\nIMPORTANT: Respond with a strict JSON object ONLY. No markdown, no code fences, no explanation.";

    body = JSON.stringify({
      model: model,
      system: sysContent,
      messages: claudeMsgs,
      max_tokens: 4096,
      temperature: 0.1
    });

  } else if (fmt === "gemini") {
    url = endpoint + "/v1beta/models/" + model + ":generateContent?key=" + apiKey;
    headers = { "Content-Type": "application/json" };

    const systemText = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
    const userText = messages.filter(m => m.role !== "system").map(m => m.content).join("\n");

    const parts = [];
    let combined = systemText + "\n\n" + userText;
    if (forceJson) combined += "\n\nRespond with a strict JSON object ONLY.";
    parts.push({ text: combined });
    if (screenshotBase64) {
      parts.push({ inline_data: { mime_type: "image/png", data: screenshotBase64 } });
    }

    const genConfig = {
      temperature: 0.1,
      maxOutputTokens: 4096
    };
    if (forceJson) genConfig.responseMimeType = "application/json";

    body = JSON.stringify({
      contents: [{ parts: parts }],
      generationConfig: genConfig
    });

  } else {
    throw new Error("Unknown provider / API format: " + provider + " (" + fmt + ")");
  }

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeout);
  const t0 = performance.now();
  let resp;

  try {
    resp = await fetch(url, {
      method: "POST",
      headers: headers,
      body: body,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timerId);
    const ms = Math.round(performance.now() - t0);

    if (err.name === "AbortError") {
      broadcastLog({
        kind: "ollama_error",
        label: "LLM Timeout [" + label + "]",
        data: { timeout_ms: timeout, elapsed_ms: ms, model: model, provider: provider }
      });
      throw new Error("LLM did not respond within " + Math.round(timeout / 1000) + "s. Try a faster model or increase timeout.");
    }
    broadcastLog({
      kind: "ollama_error",
      label: "Network Error [" + label + "]",
      data: { error: err.message, elapsed_ms: ms, model: model, provider: provider }
    });
    throw new Error("Network error calling " + provider + "/" + model + ": " + err.message);
  }

  clearTimeout(timerId);
  const ms = Math.round(performance.now() - t0);

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    broadcastLog({
      kind: "ollama_error",
      label: "HTTP " + resp.status + " [" + label + "]",
      data: { status: resp.status, body: errText.slice(0, 500), elapsed_ms: ms, model: model, provider: provider }
    });
    if (resp.status === 403 && (provider === "ollama_local" || provider === "ollama_cloud")) {
      throw new Error("Ollama rejected the request (403). Set OLLAMA_ORIGINS=* in your environment and restart Ollama to allow extension access.");
    }
    throw new Error(provider + " " + resp.status + ": " + errText.slice(0, 200));
  }

  const raw = await resp.json();

  let content = "";
  let thinkingText = "";

  if (fmt === "ollama") {
    content = (raw.message && raw.message.content) || "";
    // Ollama models (DeepSeek, Qwen etc.) put reasoning in message.thinking
    thinkingText = (raw.message && raw.message.thinking) || "";
    // Some models embed thinking in <think> tags inside content
    if (!thinkingText && content) {
      var thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        thinkingText = thinkMatch[1].trim();
        content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
      }
    }
    broadcastLog({
      kind: "ollama_response",
      label: "LLM Response [" + label + "]",
      data: {
        raw: raw, elapsed_ms: ms,
        model: raw.model || model,
        provider: provider,
        eval_count: raw.eval_count,
        total_duration: raw.total_duration
      }
    });

  } else if (fmt === "openai") {
    content = (raw.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.content) || "";
    // OpenAI o-series / DeepSeek-R1 put reasoning in reasoning_content
    thinkingText = (raw.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.reasoning_content) || "";
    // DeepSeek models may also use <think> tags
    if (!thinkingText && content) {
      var thinkMatch2 = content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch2) {
        thinkingText = thinkMatch2[1].trim();
        content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
      }
    }
    broadcastLog({
      kind: "ollama_response",
      label: "LLM Response [" + label + "]",
      data: {
        raw: raw, elapsed_ms: ms,
        model: raw.model || model,
        provider: provider,
        usage: raw.usage
      }
    });

  } else if (fmt === "claude") {
    // Claude returns content array — thinking blocks have type "thinking"
    if (raw.content && Array.isArray(raw.content)) {
      content = raw.content.filter(b => b.type === "text").map(b => b.text).join("");
      var thinkingBlocks = raw.content.filter(b => b.type === "thinking");
      if (thinkingBlocks.length > 0) {
        thinkingText = thinkingBlocks.map(b => b.thinking || "").join("\n\n");
      }
      // Fallback: if no text blocks, check thinking blocks for embedded JSON
      if (!content && thinkingBlocks.length > 0 && forceJson) {
        var thinkingJoin = thinkingBlocks.map(b => b.thinking || "").join("\n");
        var jsonInThinking = thinkingJoin.match(/\{[\s\S]*?"action"\s*:\s*"[\s\S]*?\}/);
        if (jsonInThinking) content = jsonInThinking[0];
      }
    }
    broadcastLog({
      kind: "ollama_response",
      label: "LLM Response [" + label + "]",
      data: {
        raw: raw, elapsed_ms: ms,
        model: raw.model || model,
        provider: provider,
        usage: raw.usage
      }
    });

  } else if (fmt === "gemini") {
    if (raw.candidates && raw.candidates[0] && raw.candidates[0].content && raw.candidates[0].content.parts) {
      content = raw.candidates[0].content.parts.map(p => p.text || "").join("");
    }
    // Gemini thinking models may have thoughtContent
    if (raw.candidates && raw.candidates[0] && raw.candidates[0].groundingMetadata && raw.candidates[0].groundingMetadata.searchEntryPoint) {
      // Not really thinking, but check for thought field
    }
    if (raw.candidates && raw.candidates[0] && raw.candidates[0].thoughtContent) {
      thinkingText = raw.candidates[0].thoughtContent;
    }
    broadcastLog({
      kind: "ollama_response",
      label: "LLM Response [" + label + "]",
      data: {
        raw: raw, elapsed_ms: ms,
        model: model,
        provider: provider,
        usage: raw.usageMetadata
      }
    });
  }

  // Broadcast thinking log if the model produced reasoning
  if (thinkingText && thinkingText.trim()) {
    broadcastLog({
      kind: "thinking",
      label: "LLM Reasoning [" + label + "]",
      data: { thinkingText: thinkingText.trim(), model: model, provider: provider, elapsed_ms: ms }
    });
  }

  // For chat mode, return raw content without JSON parsing
  if (!forceJson) {
    return { _rawContent: content };
  }

  // Warn if content is empty — helps diagnose provider-specific issues
  if (!content && forceJson) {
    broadcastLog({ kind: "warn", label: "LLM Empty Response", data: { provider: fmt, rawKeys: Object.keys(raw || {}).join(","), rawError: raw && raw.error ? JSON.stringify(raw.error) : "none" } });
  }

  // Log the raw LLM output before parsing
  broadcastLog({
    kind: "llm_raw",
    label: "LLM Raw Output [" + label + "]",
    data: { rawContent: content, model: model, provider: provider }
  });

  const action = parseActionJSON(content);
  resolveActionSelector(action);
  if (thinkingText && thinkingText.trim()) {
    action._thinking = thinkingText.trim();
  }
  broadcastLog({ kind: "parsed_action", label: "Parsed Action [" + label + "]", data: action });
  return action;
}

// Reconstruct selector from id for LLM-produced actions
function resolveActionSelector(action) {
  if (action && action.id != null && !action.selector) {
    action.selector = `[data-agent-id="${action.id}"]`;
  }
  if (action && action.action === "plan" && Array.isArray(action.steps)) {
    action.steps.forEach(step => {
      if (step.id != null && !step.selector) {
        step.selector = `[data-agent-id="${step.id}"]`;
      }
    });
  }
}

function parseActionJSON(raw) {
  // Try direct parse
  try {
    const p = JSON.parse(raw);
    if (p.action) return p;
  } catch {}

  // Strip markdown fences if present
  const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try {
    const p = JSON.parse(stripped);
    if (p.action) return p;
  } catch {}

  // Regex extract — find the outermost balanced braces containing "action"
  const m = raw.match(/\{[\s\S]*?"action"\s*:\s*"[\s\S]*?\}/);
  if (m) {
    try {
      const p = JSON.parse(m[0]);
      if (p.action) return p;
    } catch {}
  }

  // FAILED: return a special marker so we can escalate to vision
  return { _parseFailed: true, _rawContent: raw };
}

/* ═══════════════════════════════════════════
 * ESCALATION DETECTION (v2 — more aggressive, no 300 cap)
 * ═══════════════════════════════════════════ */

function checkEscalation(action, result, prevEntry, pageState) {
  // T0: JSON parse failure — LLM returned garbage
  if (action._parseFailed) {
    return { should: true, reason: "DOM LLM returned unparseable response. Switching to vision. Raw: " + (action._rawContent || "").slice(0, 100) };
  }

  // T1: LLM explicitly confused
  if (action.action === "error") {
    return { should: true, reason: 'DOM LLM gave up: "' + (action.reason || "unknown") + '". Trying vision.' };
  }

  // T2: Execution failed (selector not found, element missing, etc.)
  if (result && !result.success) {
    return { should: true, reason: 'Action "' + action.action + '" failed: ' + (result.error || "unknown") + ". Switching to vision." };
  }

  // T3: Hallucinated id — id doesn't match any known element
  if (action.id != null && pageState && pageState.elements) {
    const idExists = pageState.elements.some(el => String(el.id) === String(action.id));
    if (!idExists) {
      return { should: true, reason: "LLM used non-existent element id: " + action.id + ". Likely hallucinating. Switching to vision." };
    }
  }

  // T4: Repeated identical action — scan last 4 entries (not just prev)
  // Catches patterns like: type "X" → key Enter → type "X" (duplicate separated by Enter)
  if (agentState.history.length > 0) {
    const recentEntries = agentState.history.slice(-4);
    for (let ri = recentEntries.length - 1; ri >= 0; ri--) {
      const pe = recentEntries[ri];
      const same = pe.action === action.action;
      const sameSel = (action.id != null && String(pe.id) === String(action.id)) || (action.selector && pe.selector === action.selector);
      const sameUrl = action.url && pe.url === action.url;
      const sameVal = action.value && pe.value === action.value && action.action === "type";
      const sameDir = action.direction && pe.direction === action.direction && action.action === "scroll";
      const sameCoords = pe.mode === "vision" && action.x != null && pe.x != null &&
        Math.abs(action.x - pe.x) < 10 && Math.abs(action.y - pe.y) < 10;

      if (same && (sameSel || sameUrl || sameVal || sameCoords)) {
        return { should: true, reason: "Agent repeated: " + action.action + (action.id != null ? " on element #" + action.id : sameCoords ? " at (" + action.x + "," + action.y + ")" : "") + " (matched step " + pe.step + "). Likely stuck. Switching to vision." };
      }
    }
    // Scroll direction check (3+ same-direction scrolls)
    if (prevEntry && prevEntry.action === "scroll" && action.action === "scroll" &&
        prevEntry.direction === action.direction && prevEntry.result === "success") {
      const lastTwo = agentState.history.slice(-2);
      if (lastTwo.length >= 2 && lastTwo.every(h => h.action === "scroll" && h.direction === action.direction)) {
        return { should: true, reason: "Scrolled " + action.direction + " 3+ times — content might not be scrollable or goal element not found. Switching to vision." };
      }
    }
  }

  // T4b: Window-based cycle detection — same action+target appeared 2+ times in last 6 steps.
  // Catches A-B-A oscillation and A-B-C-A-B-A patterns that T4 misses.
  const last6 = agentState.history.slice(-6);
  const currentKey = action.action + "|" + (action.id != null ? String(action.id) : action.selector || action.url ||
                     (action.value ? action.value.slice(0, 30) : "") || "");
  const repeatCount = last6.filter(h => {
    const k = h.action + "|" + (h.id != null ? String(h.id) : h.selector || h.url ||
              (h.value ? h.value.slice(0, 30) : "") || "");
    return k === currentKey;
  }).length;
  if (repeatCount >= 2 || (repeatCount >= 1 && action.action === "type")) {
    return { should: true, reason: '"' + action.action + '" on same target repeated ' + (repeatCount + 1) + '\u00d7 in last ' + (last6.length + 1) + ' steps \u2014 cycle detected. Switching to vision.' };
  }

  // T4c: No-progress detection — 5+ successful click/type actions but zero stateAfter changes.
  // Catches silent loops where the agent keeps clicking the wrong elements.
  const last5 = agentState.history.slice(-5);
  if (last5.length >= 5 &&
      last5.every(h => (h.action === "click" || h.action === "type") &&
                       h.result === "success" && !h.stateAfter && !h.effectObserved)) {
    return { should: true, reason: "5 consecutive actions with no observable effect \u2014 silent loop detected. Switching to vision." };
  }

  // T4d: URL stagnation — same URL for 5+ steps with no state changes at all.
  if (agentState.history.length >= 5) {
    const recent5 = agentState.history.slice(-5);
    const urls = recent5.map(h => h.pageUrl).filter(Boolean);
    const allSameUrl = urls.length >= 5 && urls.every(u => u === urls[0]);
    const noChanges = recent5.every(h => !h.stateAfter && !h.effectObserved && !h.urlChanged);
    if (allSameUrl && noChanges) {
      return { should: true, reason: "URL unchanged for 5+ steps with no observable changes \u2014 agent appears stuck." };
    }
  }

  // T4e: Selector oscillation — cycling through ≤3 selectors in 6+ click/type actions.
  if (agentState.history.length >= 6) {
    const last8 = agentState.history.slice(-8);
    const clickTypes = last8.filter(h => h.action === "click" || h.action === "type");
    if (clickTypes.length >= 6) {
      const targets = new Set(clickTypes.map(h => h.id != null ? String(h.id) : h.selector).filter(Boolean));
      if (targets.size <= 3 && targets.size > 0) {
        return { should: true, reason: "Cycling through " + targets.size + " elements in last " + clickTypes.length + " actions \u2014 oscillation detected." };
      }
    }
  }

  return { should: false, reason: "" };
}

function stepFailed(action, result) {
  if (!action || action._parseFailed) return true;
  if (action.action === "error") return true;
  if (action.action === "done") return false;
  if (result && !result.success) return true;
  if (!result) return true;
  return false;
}

function validateVisionAction(action, hasSoM) {
  if (action.action === "click" || action.action === "type") {
    const hasElement = action.element != null;
    const hasCoords  = action.x != null && action.y != null;
    if (hasSoM && !hasElement && !hasCoords) {
      return 'SoM is active — use an element number or provide x/y coordinates for unnumbered targets.';
    }
    if (!hasElement && !hasCoords) {
      return 'Vision model returned "' + action.action + '" without element number or x/y coordinates.';
    }
    if (hasCoords && !hasElement) {
      if (typeof action.x !== "number" || typeof action.y !== "number") {
        return "Non-numeric coordinates: x=" + action.x + ", y=" + action.y;
      }
      if (action.x < 0 || action.y < 0) {
        return "Negative coordinates: (" + action.x + ", " + action.y + ")";
      }
    }
  }
  if (action.action === "type" && !action.value) {
    return 'Vision "type" action has no value.';
  }
  if ((action.action === "click" || action.action === "type") && action.selector && action.x == null && action.element == null) {
    return 'Vision model returned selector "' + action.selector + '" instead of element number or coordinates.';
  }
  return null;
}

/* ═══════════════════════════════════════════
 * CDP ACTION DISPATCH (trusted events)
 * ═══════════════════════════════════════════ */

async function getElementCenter(tabId, selector, hints, frameId) {
  const ok = await ensureContentScript(tabId);
  if (!ok) throw new Error("Content script not available for bounds query.");
  const resp = await sendToTabRobust(tabId, { type: "GET_ELEMENT_BOUNDS", selector, hints: hints || {} }, frameId || 0);
  if (!resp || !resp.success) throw new Error((resp && resp.error) || "Could not get element bounds");
  const b = resp.bounds;
  return {
    x: b.x + b.w / 2,
    y: b.y + b.h / 2,
    bounds: b,
    tag: resp.tag,
    isInput: resp.isInput,
    isSelect: resp.isSelect,
    isContentEditable: resp.isContentEditable,
    isMedia: resp.isMedia,
    hasForm: resp.hasForm,
    type: resp.type
  };
}

async function getElementSnapshotAfter(tabId, selector, hints, frameId) {
  try {
    const resp = await sendToTabRobust(tabId, { type: "GET_ELEMENT_SNAPSHOT", selector, hints: hints || {} }, frameId || 0);
    return resp && resp.success ? resp : null;
  } catch { return null; }
}

async function dispatchDOMActionCDP(tabId, action) {
  if (action.action === "navigate") {
    await chrome.tabs.update(tabId, { url: action.url });
    await waitForTabLoad(tabId);
    return { success: true, action: "navigate", url: action.url };
  }
  if (action.action === "done" || action.action === "error") {
    return { success: true, action: action.action };
  }
  if (action.action === "wait") {
    await sleep(action.ms || 1000);
    return { success: true, action: "wait" };
  }

  // For selector-based actions, resolve frameId for iframe elements
  let frameId = 0;
  let selector = action.selector;
  if (selector) {
    const m = selector.match(/\[data-agent-id="(\d+):(\d+)"\]/);
    if (m) {
      frameId = parseInt(m[1], 10);
      selector = `[data-agent-id="${m[2]}"]`;
    }
  }

  // CDP shadow DOM elements — use stored bounds directly
  const isCDPShadow = selector && selector.startsWith("[cdp-shadow-node=");

  switch (action.action) {

    case "click": {
      let cx, cy;
      if (isCDPShadow) {
        // Get bounds from the element hints (attached by attachHints)
        const h = action._hints || {};
        if (h.bounds) { cx = h.bounds.x + h.bounds.w / 2; cy = h.bounds.y + h.bounds.h / 2; }
        else throw new Error("CDP shadow element has no bounds");
      } else {
        const info = await getElementCenter(tabId, selector, action._hints, frameId);
        cx = info.x; cy = info.y;
        // Media elements: still use content script for play/pause toggle (CDP click doesn't help with media API)
        if (info.isMedia) {
          return await sendToTabRobust(tabId, { type: "EXECUTE_ACTION", action: Object.assign({}, action, { selector }) }, frameId);
        }
      }
      await cdpHover(cx, cy);
      await sleep(50);
      await cdpClick(cx, cy);
      await sleep(100);
      const res = { success: true, action: "click", selector: action.selector, description: action.description || "" };
      if (!isCDPShadow) {
        const after = await getElementSnapshotAfter(tabId, selector, action._hints, frameId);
        if (after && after.snapshot) res.stateAfter = after.snapshot;
      }
      res.effectObserved = true;
      return res;
    }

    case "type": {
      const info = await getElementCenter(tabId, selector, action._hints, frameId);
      // ContentEditable: fall back to content script (execCommand is simpler)
      if (info.isContentEditable) {
        return await sendToTabRobust(tabId, { type: "EXECUTE_ACTION", action: Object.assign({}, action, { selector }) }, frameId);
      }
      // Click to focus
      await cdpClick(info.x, info.y);
      await sleep(150);
      // Select all existing text and delete it
      await cdpSelectAll();
      await sleep(50);
      await cdpKeyPress("Backspace");
      await sleep(50);
      // Type the value
      await cdpType(action.value);
      await sleep(50);
      // Submit if requested
      if (action.then_submit) {
        await sleep(100);
        await cdpKeyPress("Enter");
      }
      await sleep(100);
      return { success: true, action: "type", selector: action.selector, value: action.value };
    }

    case "select": {
      // Native SELECT: fall back to content script (CDP doesn't help with select dropdowns)
      const info = await getElementCenter(tabId, selector, action._hints, frameId);
      if (info.isSelect) {
        return await sendToTabRobust(tabId, { type: "EXECUTE_ACTION", action: Object.assign({}, action, { selector }) }, frameId);
      }
      // Custom dropdown: click to open
      await cdpClick(info.x, info.y);
      await sleep(300);
      return { success: true, action: "select", selector: action.selector, note: "Clicked custom dropdown to open." };
    }

    case "key": {
      if (selector) {
        const info = await getElementCenter(tabId, selector, action._hints, frameId);
        await cdpClick(info.x, info.y);
        await sleep(50);
      }
      await cdpKeyPress(action.key);
      return { success: true, action: "key", key: action.key };
    }

    case "hover": {
      const info = await getElementCenter(tabId, selector, action._hints, frameId);
      await cdpHover(info.x, info.y);
      await sleep(200);
      return { success: true, action: "hover", selector: action.selector };
    }

    case "scroll": {
      const dir = action.direction || "down";
      const amt = action.amount || 400;
      const pageInfo = await getPageInfo(tabId);
      const cx = pageInfo.viewportWidth / 2;
      const cy = pageInfo.viewportHeight / 2;
      const deltaY = (dir === "up") ? -amt : (dir === "down") ? amt : 0;
      const deltaX = (dir === "left") ? -amt : (dir === "right") ? amt : 0;
      await cdpScroll(cx, cy, deltaX, deltaY);
      await sleep(300);
      return { success: true, action: "scroll", direction: dir };
    }

    default:
      throw new Error("Unsupported CDP action: " + action.action);
  }
}

async function dispatchVisionActionCDP(tabId, action) {
  if (action.action === "navigate") {
    await chrome.tabs.update(tabId, { url: action.url });
    await waitForTabLoad(tabId);
    return { success: true, action: "navigate", url: action.url };
  }
  if (action.action === "done" || action.action === "error") {
    return { success: true, action: action.action };
  }
  if (action.action === "wait") {
    await sleep(action.ms || 1000);
    return { success: true, action: "wait" };
  }

  // SoM-resolved actions (have _somSelector) — use DOM CDP path
  if (action._somSelector) {
    const domAction = { action: action.action, selector: action._somSelector, _hints: {} };
    if (action.value != null) domAction.value = action.value;
    if (action.then_submit) domAction.then_submit = action.then_submit;
    if (action.description) domAction.description = action.description;
    try {
      return await dispatchDOMActionCDP(tabId, domAction);
    } catch (err) {
      // SoM selector stale — fall through to coordinate click
      if (action._somFallbackX != null) {
        broadcastLog({ kind: "system", label: "CDP SoM Fallback → coords", data: { x: action._somFallbackX, y: action._somFallbackY } });
      } else {
        throw err;
      }
    }
  }

  // Coordinate-based actions
  switch (action.action) {
    case "click": {
      const x = action._somFallbackX != null ? action._somFallbackX : action.x;
      const y = action._somFallbackY != null ? action._somFallbackY : action.y;
      if (x == null || y == null) throw new Error("No coordinates for vision click");
      await cdpHover(x, y);
      await sleep(50);
      await cdpClick(x, y);
      return { success: true, action: "click", x, y, description: action.description || "" };
    }
    case "type": {
      const x = action._somFallbackX != null ? action._somFallbackX : action.x;
      const y = action._somFallbackY != null ? action._somFallbackY : action.y;
      if (x == null || y == null) throw new Error("No coordinates for vision type");

      // Click to focus the input
      await cdpClick(x, y);
      await sleep(150);

      // Verify an editable element is focused before Ctrl+A (prevents selecting entire page)
      var focusCheck;
      try { focusCheck = await sendToTabRobust(tabId, { type: "CHECK_FOCUS" }); } catch { focusCheck = null; }

      if (focusCheck && focusCheck.editable) {
        await cdpSelectAll();
        await sleep(50);
        await cdpKeyPress("Backspace");
        await sleep(50);
      } else {
        // Click missed the input — retry
        broadcastLog({ kind: "warn", label: "Vision Type: Focus Miss", data: { x, y, focused: focusCheck } });
        await cdpClick(x, y);
        await sleep(150);
        try { focusCheck = await sendToTabRobust(tabId, { type: "CHECK_FOCUS" }); } catch { focusCheck = null; }
        if (focusCheck && focusCheck.editable) {
          await cdpSelectAll();
          await sleep(50);
          await cdpKeyPress("Backspace");
          await sleep(50);
        }
        // If still not focused, type anyway (best effort)
      }

      await cdpType(action.value);
      if (action.then_submit) {
        await sleep(100);
        await cdpKeyPress("Enter");
      }
      return { success: true, action: "type", x, y, value: action.value, description: action.description || "" };
    }
    case "key": {
      await cdpKeyPress(action.key);
      return { success: true, action: "key", key: action.key };
    }
    case "hover": {
      const x = action.x != null ? action.x : 0;
      const y = action.y != null ? action.y : 0;
      await cdpHover(x, y);
      return { success: true, action: "hover", x, y };
    }
    case "scroll": {
      const pageInfo = await getPageInfo(tabId);
      const cx = pageInfo.viewportWidth / 2;
      const cy = pageInfo.viewportHeight / 2;
      const dir = action.direction || "down";
      const amt = action.amount || 400;
      const deltaY = (dir === "up") ? -amt : (dir === "down") ? amt : 0;
      const deltaX = (dir === "left") ? -amt : (dir === "right") ? amt : 0;
      await cdpScroll(cx, cy, deltaX, deltaY);
      return { success: true, action: "scroll", direction: dir };
    }
    default:
      throw new Error("Unsupported CDP vision action: " + action.action);
  }
}

/* ═══════════════════════════════════════════
 * ACTION DISPATCH (synthetic fallback)
 * ═══════════════════════════════════════════ */

async function dispatchDOMAction(tabId, action) {
  // Try CDP path first for trusted events
  if (debuggerState.attached && debuggerState.tabId === tabId) {
    try {
      return await dispatchDOMActionCDP(tabId, action);
    } catch (err) {
      broadcastLog({ kind: "system", label: "CDP Fallback", data: { error: err.message, action: action.action, fallback: "synthetic" } });
    }
  }
  // ── Synthetic event fallback (original code) ──
  if (action.action === "navigate") {
    await chrome.tabs.update(tabId, { url: action.url });
    await waitForTabLoad(tabId);
    return { success: true, action: "navigate", url: action.url };
  }
  if (action.action === "done" || action.action === "error") {
    return { success: true, action: action.action };
  }
  const ok = await ensureContentScript(tabId);
  if (!ok) throw new Error("Content script not available.");

  // Selectors for iframe elements are encoded as [data-agent-id="<frameId>:<agentId>"].
  // Parse out the frameId and strip the prefix before sending to the content script.
  let frameId = 0;
  let resolvedAction = action;
  if (action.selector) {
    const m = action.selector.match(/\[data-agent-id="(\d+):(\d+)"\]/);
    if (m) {
      frameId = parseInt(m[1], 10);
      resolvedAction = Object.assign({}, action, { selector: `[data-agent-id="${m[2]}"]` });
    }
  }

  return await sendToTabRobust(tabId, { type: "EXECUTE_ACTION", action: resolvedAction, replayMode: !!action._replayMode }, frameId);
}

async function dispatchVisionAction(tabId, action) {
  // Try CDP path first for trusted events
  if (debuggerState.attached && debuggerState.tabId === tabId) {
    try {
      return await dispatchVisionActionCDP(tabId, action);
    } catch (err) {
      broadcastLog({ kind: "system", label: "CDP Vision Fallback", data: { error: err.message, action: action.action, fallback: "synthetic" } });
    }
  }
  // ── Synthetic event fallback (original code) ──
  if (action.action === "navigate") {
    await chrome.tabs.update(tabId, { url: action.url });
    await waitForTabLoad(tabId);
    return { success: true, action: "navigate", url: action.url };
  }
  if (action.action === "scroll" || action.action === "wait") {
    const ok = await ensureContentScript(tabId);
    if (!ok) throw new Error("Content script not available.");
    return await sendToTabRobust(tabId, { type: "EXECUTE_ACTION", action: action }, 0);
  }
  if (action.action === "done" || action.action === "error") {
    return { success: true, action: action.action };
  }
  if ((action.action === "click" || action.action === "type") && action._somSelector) {
    // SoM element number was resolved to a selector — use DOM dispatch (precise, scroll-safe).
    const ok = await ensureContentScript(tabId);
    if (!ok) throw new Error("Content script not available.");
    const domAction = { action: action.action, selector: action._somSelector };
    if (action.value != null) domAction.value = action.value;
    if (action.then_submit) domAction.then_submit = action.then_submit;
    if (action.description) domAction.description = action.description;
    const domResult = await sendToTabRobust(tabId, { type: "EXECUTE_ACTION", action: domAction }, 0);
    // If selector is stale (element re-rendered) fall back to stored center coords immediately.
    if (!domResult.success && action._somFallbackX != null) {
      broadcastLog({ kind: "system", label: "SoM Selector Fallback", data: { selector: action._somSelector, x: action._somFallbackX, y: action._somFallbackY } });
      const fallbackAction = Object.assign({}, action, { x: action._somFallbackX, y: action._somFallbackY });
      const iframeInfo = await checkVisionInsideIframe(tabId, fallbackAction.x, fallbackAction.y);
      const frameId = iframeInfo ? iframeInfo.frameId : 0;
      const frameAction = iframeInfo ? Object.assign({}, fallbackAction, { x: iframeInfo.relX, y: iframeInfo.relY }) : fallbackAction;
      return await sendToTabRobust(tabId, { type: "EXECUTE_VISION_ACTION", action: frameAction }, frameId);
    }
    return domResult;
  }
  if (action.action === "click" || action.action === "type") {
    const ok = await ensureContentScript(tabId);
    if (!ok) throw new Error("Content script not available.");

    // Check if the click/type coords land inside an iframe — if so, route to that frame
    // with coordinates translated to the iframe's local coordinate space.
    let targetFrameId = 0;
    let targetAction = action;
    const iframeInfo = await checkVisionInsideIframe(tabId, action.x, action.y);
    if (iframeInfo) {
      targetFrameId = iframeInfo.frameId;
      targetAction = Object.assign({}, action, { x: iframeInfo.relX, y: iframeInfo.relY });
      broadcastLog({ kind: "system", label: "Vision → iframe", data: { frameId: targetFrameId, relX: iframeInfo.relX, relY: iframeInfo.relY } });
    }

    return await sendToTabRobust(tabId, { type: "EXECUTE_VISION_ACTION", action: targetAction }, targetFrameId);
  }
  // key and hover: no iframe routing needed — dispatch to main frame
  if (action.action === "key" || action.action === "hover") {
    const ok = await ensureContentScript(tabId);
    if (!ok) throw new Error("Content script not available.");
    return await sendToTabRobust(tabId, { type: "EXECUTE_VISION_ACTION", action }, 0);
  }
  return { success: false, error: "Unknown vision action: " + action.action };
}

function waitForTabLoad(tabId, timeout) {
  timeout = timeout || 15000;
  return new Promise(resolve => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, timeout);
    function fn(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(fn);
        setTimeout(resolve, 400);
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

/* ═══════════════════════════════════════════
 * VISION — single attempt with configurable SoM cap
 * ═══════════════════════════════════════════ */

async function _attemptVisionOnce(tabId, goal, reason, vm, somCap = 80) {
  broadcastLog({ kind: "system", label: "Escalating to Vision", data: { reason: reason, visionModel: vm, provider: agentState.provider } });
  broadcastStatus({ status: "capturing", message: "Step " + agentState.step + ": Capturing screenshot…" });

  const rawScreenshot = await captureScreenshot(tabId);
  if (!rawScreenshot) {
    broadcastLog({ kind: "error", label: "Vision Escalation Failed", data: { error: "Screenshot returned null" } });
    return null;
  }

  let pageInfo;
  try { pageInfo = await getPageInfo(tabId); }
  catch (err) {
    broadcastLog({ kind: "error", label: "Vision Escalation Failed", data: { error: err.message } });
    return null;
  }

  // Downscale screenshot to CSS viewport dimensions so image pixels = CSS pixels.
  const cssW = pageInfo.viewportWidth;
  const cssH = pageInfo.viewportHeight;
  const screenshot = await downscaleScreenshot(rawScreenshot, cssW, cssH);

  broadcastLog({
    kind: "page_state",
    label: "Page Info (Vision)",
    data: {
      url: pageInfo.url, title: pageInfo.title,
      viewport: cssW + "x" + cssH,
      scroll: pageInfo.scrollY + "/" + pageInfo.documentHeight,
      mode: "vision — screenshot (CSS-scaled)"
    }
  });

  // ── Set-of-Marks: capture in-viewport elements and annotate the screenshot ──
  let somElements = [];
  let visionScreenshot = screenshot;
  try {
    const pageState = await capturePageState(tabId);
    var viewportElements = (pageState.elements || []).filter(el => el.inViewport && el.bounds);
    somElements = rankElements(viewportElements, goal, cssH).slice(0, somCap);
    if (somElements.length > 0) {
      visionScreenshot = await annotateScreenshot(screenshot, somElements, cssW, cssH);
      broadcastLog({ kind: "system", label: "Set-of-Marks", data: { elements: somElements.length } });
    }
  } catch (err) {
    broadcastLog({ kind: "system", label: "SoM Skipped", data: { error: err.message } });
  }

  const visionPInfo = await getPersonalInfoBlock(goal);
  const msgs = buildVisionPrompt(goal, pageInfo, agentState.history, reason, somElements.length > 0 ? somElements : null, visionPInfo);

  broadcastStatus({ status: "thinking", message: "Step " + agentState.step + ": Vision model (" + vm + ") analyzing…" });

  let action;
  try {
    action = await callLLM(msgs, vm, "Vision", visionScreenshot, { timeout: 25000 });
  } catch (err) {
    broadcastLog({ kind: "error", label: "Vision LLM Failed", data: { error: err.message } });
    return null;
  }

  // Handle parse failure — retry once before giving up
  if (action._parseFailed) {
    broadcastLog({ kind: "warn", label: "Vision Parse Failed, Retrying", data: { raw: action._rawContent } });
    try {
      action = await callLLM(msgs, vm, "Vision-Retry", visionScreenshot, { timeout: 25000 });
    } catch (retryErr) {
      broadcastLog({ kind: "error", label: "Vision Retry Also Failed", data: { error: retryErr.message } });
      return null;
    }
  }
  if (!action || action._parseFailed) {
    broadcastLog({ kind: "error", label: "Vision Response Unparseable", data: { raw: action ? action._rawContent : "" } });
    return null;
  }

  const validErr = validateVisionAction(action, somElements.length > 0);
  if (validErr) {
    broadcastLog({ kind: "error", label: "Vision Response Invalid", data: { error: validErr, action: action } });
    return null;
  }

  // ── Resolve element number → selector (preferred) or CSS coords fallback ──
  if (action.element != null && somElements.length > 0) {
    const el = somElements[action.element - 1];
    if (el) {
      if (el.selector) {
        const fbX = el.bounds ? Math.round(el.bounds.x + el.bounds.w / 2) : null;
        const fbY = el.bounds ? Math.round(el.bounds.y + el.bounds.h / 2) : null;
        action = Object.assign({}, action, { _somSelector: el.selector, _somFallbackX: fbX, _somFallbackY: fbY });
        broadcastLog({ kind: "system", label: "SoM Resolved (selector)", data: { element: action.element, selector: el.selector, text: el.text } });
      } else if (el.bounds) {
        action = Object.assign({}, action, {
          x: Math.round(el.bounds.x + el.bounds.w / 2),
          y: Math.round(el.bounds.y + el.bounds.h / 2)
        });
        broadcastLog({ kind: "system", label: "SoM Resolved (coords)", data: { element: action.element, cssX: action.x, cssY: action.y, text: el.text } });
      }
    }
  }
  // Raw x/y from LLM — already in CSS pixels, no scaling needed.

  broadcastStatus({
    status: "acting",
    message: "Step " + agentState.step + ": Vision → " + action.action +
      (action.element != null ? " elem#" + action.element : "") +
      (action.x != null ? " at (" + action.x + "," + action.y + ") [CSS px]" : "")
  });

  let result;
  try { result = await dispatchVisionAction(tabId, action); }
  catch (err) { result = { success: false, error: err.message }; }

  broadcastLog({
    kind: "execution",
    label: "Vision Action: " + action.action + (action.x != null ? " @ (" + action.x + "," + action.y + ")" : ""),
    data: { action: action, result: result, mode: "vision_escalation" }
  });

  const entry = {
    step: agentState.step, action: action.action,
    result: result.success ? "success" : "failed",
    mode: "vision"
  };
  if (action.x != null) { entry.x = action.x; entry.y = action.y; }
  if (action.description) entry.description = action.description;
  if (action.value) entry.value = action.value;
  if (action.url) entry.url = action.url;
  if (action.summary) entry.summary = action.summary;
  if (action.reason) entry.reason = action.reason;
  if (action.remaining) entry.remaining = action.remaining;
  if (action.completed) entry.completed = action.completed;
  if (action.manual_steps) entry.manual_steps = action.manual_steps;
  if (result.error) entry.error = result.error;
  if (result.clickedTag) entry.clickedTag = result.clickedTag;
  if (result.clickedText) entry.clickedText = result.clickedText;

  return { action: action, result: result, historyEntry: entry };
}

/* ═══════════════════════════════════════════
 * CHAT MODE
 * ═══════════════════════════════════════════ */

async function initChat(tabId) {
  await loadConfig();

  chatState.active = true;
  chatState.tabId = tabId;
  chatState.messages = [];

  try {
    const summary = await capturePageSummary(tabId);
    if (!summary) throw new Error("Could not capture page content.");

    // If page content looks like an overlay or is too sparse, use screenshot + vision
    if (summary.overlayDetected || summary.text.trim().length < 100) {
      try {
        const vm = agentState.visionModel ? agentState.visionModel.trim() : "";
        const screenshotModel = vm || agentState.model;
        const screenshot = await captureScreenshot(tabId);
        if (screenshot) {
          const visionResult = await callLLM([
            { role: "system", content: "Describe what this web page is about in 2-3 paragraphs. Ignore any cookie banners, popups, or overlays. Focus on the main content of the page." },
            { role: "user", content: "What is the main content of this page?" }
          ], screenshotModel, "ChatVision", screenshot, { forceJson: false, timeout: 25000 });
          if (visionResult && visionResult._rawContent) {
            summary.text = visionResult._rawContent + "\n\n" + summary.text;
          }
        }
      } catch (err) {
        console.warn("[Agent] Vision fallback for chat failed:", err.message);
      }
    }

    chatState.pageSummary = summary;

    const historyQueue = await loadHistoryQueue();
    const systemPrompt = buildChatSystemPrompt(summary, historyQueue);
    chatState.messages = [{ role: "system", content: systemPrompt }];

    return {
      success: true,
      pageTitle: summary.title,
      pageUrl: summary.url,
      preview: summary.text.slice(0, 200) + (summary.text.length > 200 ? "…" : "")
    };
  } catch (err) {
    chatState.active = false;
    return { success: false, error: err.message };
  }
}

async function handleChatMessage(userMessage) {
  if (!chatState.active || !chatState.pageSummary) {
    return { success: false, error: "Chat not initialized. Click Chat first." };
  }

  chatState.messages.push({ role: "user", content: userMessage });

  try {
    const result = await callLLM(chatState.messages, agentState.model, "Chat", null, { forceJson: false });
    const assistantContent = result._rawContent || "";

    chatState.messages.push({ role: "assistant", content: assistantContent });

    // Keep conversation manageable — cap at ~20 messages (system + 10 turns)
    if (chatState.messages.length > 21) {
      const system = chatState.messages[0];
      chatState.messages = [system, ...chatState.messages.slice(-20)];
    }

    // Persist to history queue so future sessions have context
    pushHistoryQueue({ type: "chat", userInput: userMessage, summary: assistantContent });

    return { success: true, content: assistantContent };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function endChat() {
  chatState.active = false;
  chatState.pageSummary = null;
  chatState.messages = [];
  chatState.tabId = null;
}

function resetAllState() {
  endChat();
  agentState.history = [];
  agentState.lastThinking = "";
  agentState.logs = [];
  agentState.chatContext = null;
  agentState.goal = "";
  agentState.step = 0;
  chrome.storage.local.remove(HISTORY_QUEUE_KEY);
}

/* ═══════════════════════════════════════════
 * Progress Summary — graceful exit instead of error
 * ═══════════════════════════════════════════ */

function buildProgressSummary(history, goal, stopReason) {
  const successful = history.filter(h => h.result === "success");

  if (history.length === 0) {
    return `I was unable to start working on "${goal}".\n\n` +
      `Reason: ${stopReason}\n\n` +
      `What you can do:\n` +
      `- Make sure you're on the right page\n` +
      `- Try refreshing the page and running the task again\n` +
      `- Try completing this task manually`;
  }

  let report = `PROGRESS REPORT\nGoal: "${goal}"\n\n`;

  // What was accomplished
  report += `Completed Steps (${successful.length}/${history.length}):\n`;
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const status = h.result === "success" ? "OK" : "FAILED";
    let desc = h.description || h.action;
    if (h.url) desc += ` -> ${h.url}`;
    if (h.value) desc += ` "${h.value}"`;
    if (h.summary) desc += ` (${h.summary})`;
    report += `  ${i + 1}. [${status}] ${desc}\n`;
    if (h.error) report += `     Error: ${h.error}\n`;
  }

  // What went wrong
  report += `\nStopped because: ${stopReason}\n`;

  // What the user should do next
  const lastAction = history[history.length - 1];
  report += `\nTo complete this task manually:\n`;
  if (lastAction && lastAction.pageUrl) {
    report += `- You are currently on: ${lastAction.pageUrl}\n`;
  }
  if (lastAction && lastAction.error) {
    report += `- The last action failed: ${lastAction.error}\n`;
  }
  if (lastAction && lastAction.remaining) {
    report += `- Remaining: ${lastAction.remaining}\n`;
  }
  if (lastAction && lastAction.manual_steps) {
    report += `- Steps to finish: ${lastAction.manual_steps}\n`;
  }
  report += `- Continue from where the agent stopped and complete the remaining steps yourself\n`;

  return report;
}

function gracefulStop(goal, stopReason) {
  const detailedSummary = buildProgressSummary(agentState.history, goal, stopReason);
  const successful = agentState.history.filter(h => h.result === "success");
  const shortSummary = `Completed ${successful.length}/${agentState.history.length} steps. ${stopReason}`;

  broadcastLog({
    kind: "system", label: "Progress Report",
    data: { summary: detailedSummary, reason: stopReason, stepsCompleted: successful.length, totalSteps: agentState.history.length }
  });
  pushHistoryQueue({ type: "agent", userInput: goal, summary: shortSummary });
  broadcastStatus({ status: "done", message: shortSummary, details: detailedSummary });
}

/* ═══════════════════════════════════════════
 * MAIN AGENT LOOP
 * ═══════════════════════════════════════════ */

async function runAgentLoop(goal, tabId) {
  agentState.running = true;
  agentState.goal = goal;
  agentState.tabId = tabId;
  agentState.step = 0;
  agentState.history = [];
  agentState.lastThinking = "";
  agentState.logs = [];
  agentState.aborted = false;
  const startTime = Date.now();

  // Load chat context so agent can resolve references like "it", "that product"
  const historyQueue = await loadHistoryQueue();
  const recentChatMsgs = chatState.messages
    .filter(m => m.role !== "system")
    .slice(-6)
    .map(m => ({ role: m.role, content: (m.content || "").slice(0, 200) }));
  // Combine: history queue summaries + recent in-memory chat messages
  const chatContext = [];
  if (historyQueue.length > 0) {
    for (const h of historyQueue.slice(-5)) {
      chatContext.push({ role: "user", content: h.userInput });
      chatContext.push({ role: "assistant", content: h.summary });
    }
  }
  for (const m of recentChatMsgs) chatContext.push(m);
  agentState.chatContext = chatContext.length > 0 ? chatContext : null;

  broadcastStatus({ status: "started", message: 'Starting: "' + goal + '"' });
  broadcastLog({
    kind: "system", label: "Agent Started",
    data: { goal: goal, tabId: tabId, provider: agentState.provider, model: agentState.model, visionModel: agentState.visionModel || "(none)", timeout_ms: agentState.llmTimeout }
  });

  try {
    try {
      tabId = await ensureInjectableTab(tabId);
      agentState.tabId = tabId;
    } catch (err) {
      broadcastLog({ kind: "error", label: "Tab Setup Failed", data: { error: err.message } });
      broadcastStatus({ status: "error", message: err.message });
      return;
    }

    // Attach Chrome Debugger for trusted input events + network tracking
    const debuggerAvailable = await attachDebugger(tabId);
    if (debuggerAvailable) {
      await enableNetworkTracking();
      broadcastLog({ kind: "system", label: "Debugger Attached", data: { tabId, note: "CDP trusted events + network tracking enabled" } });
    }

    // ── Helper: attach element hints for selector-based actions ──
    function attachHints(act, ps) {
      if (act.id != null && ps && ps.elements) {
        const matched = ps.elements.find(el => String(el.id) === String(act.id));
        if (matched) {
          act._hints = {};
          if (matched.tag) act._hints.tag = matched.tag;
          if (matched.text) act._hints.text = matched.text;
          if (matched.ariaLabel) act._hints.ariaLabel = matched.ariaLabel;
          if (matched.placeholder) act._hints.placeholder = matched.placeholder;
          if (matched.role) act._hints.role = matched.role;
          if (matched.type) act._hints.type = matched.type;
          if (matched.href) act._hints.href = matched.href;
          if (matched.name) act._hints.name = matched.name;
          if (matched.htmlId) act._hints.htmlId = matched.htmlId;
          // Attach bounds for CDP shadow elements (needed for coordinate-based clicking)
          if (matched.bounds) act._hints.bounds = matched.bounds;
        }
      }
    }

    // ── Helper: build history entry for DOM actions ──
    function buildDOMHistoryEntry(action, result, pageState) {
      const entry = {
        step: agentState.step, action: action.action,
        result: result.success ? "success" : "failed",
        mode: "dom",
        pageUrl: pageState.url,
        pageTitle: pageState.title
      };
      if (action.url) entry.url = action.url;
      if (action.value) entry.value = action.value;
      if (action.description) entry.description = action.description;
      if (action.id != null) entry.id = action.id;
      if (action.selector) entry.selector = action.selector;
      if (action.summary) entry.summary = action.summary;
      if (action.reason) entry.reason = action.reason;
      if (action.remaining) entry.remaining = action.remaining;
      if (action.completed) entry.completed = action.completed;
      if (action.manual_steps) entry.manual_steps = action.manual_steps;
      if (action.direction) entry.direction = action.direction;
      if (result.error) entry.error = result.error;
      if (result.stateAfter) entry.stateAfter = result.stateAfter;
      if (result.clickedTag) entry.clickedTag = result.clickedTag;
      if (result.clickedText) entry.clickedText = result.clickedText;
      if (result.effectObserved != null) entry.effectObserved = result.effectObserved;
      if (result.urlChanged) entry.urlChanged = result.urlChanged;
      return entry;
    }

    // ── Helper: handle successful tier result ──
    async function handleTierSuccess(tr) {
      // Push history
      if (tr.historyEntry) {
        agentState.history.push(tr.historyEntry);
      } else if (tr.action && tr.result) {
        agentState.history.push(buildDOMHistoryEntry(tr.action, tr.result, tr.pageState));
      }
      // Terminal: done
      if (tr.action.action === "done") {
        broadcastLog({ kind: "system", label: "Goal Achieved", data: { summary: tr.action.summary } });
        pushHistoryQueue({ type: "agent", userInput: goal, summary: tr.action.summary || "Task completed" });
        broadcastStatus({ status: "done", message: tr.action.summary || "Goal achieved!" });
        return "done";
      }
      // Terminal: error
      if (tr.action.action === "error") {
        gracefulStop(goal, tr.action.reason || "Agent could not proceed.");
        return "error";
      }
      // Enhanced wait: network idle → loading indicators → DOM settle → SPA check
      try {
        // 1. Wait for network idle (if CDP is tracking)
        if (debuggerState.networkEnabled) {
          await waitForNetworkIdle(3000, 300);
        }

        // 2. Wait for loading indicators to clear (skeletons, spinners, progress bars)
        for (let li = 0; li < 5; li++) {
          try {
            const ls = await sendToTab(tabId, { type: "DETECT_LOADING" });
            if (!ls || !ls.loading) break;
            broadcastLog({ kind: "system", label: "Loading Detected", data: { attempt: li + 1, indicators: ls.indicators } });
            await sleep(500);
          } catch { break; }
        }

        // 3. DOM settle
        const settle = await sendToTab(tabId, { type: "WAIT_FOR_SETTLE", quiet: 300, maxWait: 3000 });
        const waited = settle && settle.elapsed || 0;
        if (waited < 400) await sleep(400 - waited);

        // 4. SPA navigation check — re-inject content script if needed
        if (agentState._spaNavigated) {
          agentState._spaNavigated = false;
          await sleep(300);
          await ensureContentScript(tabId);
        }
      } catch {
        await sleep(agentState.interStepDelay);
      }
      return "continue";
    }

    // ── Helper: handle vision tier result (done check) ──
    function handleVisionDone(vResult) {
      if (vResult && vResult.action && vResult.action.action === "done") {
        agentState.history.push(vResult.historyEntry);
        broadcastLog({ kind: "system", label: "Goal Achieved (Vision)", data: { summary: vResult.action.summary } });
        pushHistoryQueue({ type: "agent", userInput: goal, summary: vResult.action.summary || "Task completed" });
        broadcastStatus({ status: "done", message: vResult.action.summary || "Done!" });
        return true;
      }
      return false;
    }

    while (agentState.step < agentState.maxSteps && !agentState.aborted) {
      agentState.step++;

      // Wall-clock timeout check
      if (Date.now() - startTime > agentState.wallTimeout) {
        gracefulStop(goal, "Wall-clock timeout (" + Math.round(agentState.wallTimeout / 1000) + "s).");
        break;
      }

      const prev = agentState.history.length > 0 ? agentState.history[agentState.history.length - 1] : null;
      const vm = (agentState.visionModel || "").trim();
      let tierResult = null;
      let failReason = "";
      let shouldBreak = false;

      /* ═══════════════════════════════════════════
       * TIER 1: DOM (300 elements)
       * ═══════════════════════════════════════════ */
      broadcastStatus({ status: "capturing", message: "Step " + agentState.step + ": Capturing page…" });

      let pageState;
      try {
        pageState = await capturePageState(tabId);
      } catch (err) {
        await sleep(2000);
        try { pageState = await capturePageState(tabId); }
        catch (e2) { failReason = "Capture failed: " + e2.message; }
      }

      if (pageState) {
        broadcastLog({
          kind: "page_state", label: "DOM Captured",
          data: {
            url: pageState.url, title: pageState.title,
            elements_count: pageState.elements.length,
            scroll: pageState.scrollY + "/" + pageState.documentHeight,
            elements: pageState.elements
          }
        });
      }

      // Pre-fetch personal info once per step (only returns data for form-related goals)
      const personalInfoBlock = await getPersonalInfoBlock(goal);

      if (pageState && pageState.elements.length > 0) {
        // DOM LLM call
        broadcastStatus({ status: "thinking", message: "Step " + agentState.step + ": LLM deciding…" });
        let action;
        try {
          const msgs = buildDOMPrompt(goal, pageState, agentState.history, agentState.chatContext, agentState.lastThinking, personalInfoBlock);
          action = await callLLM(msgs, agentState.model, "DOM", null);
          if (action && action._thinking) {
            agentState.lastThinking = action._thinking;
          }
        } catch (err) {
          failReason = "DOM LLM error: " + err.message;
        }

        // Retry on parse failure (T0): re-call DOM LLM with error feedback
        if (action && action._parseFailed && !failReason) {
          broadcastLog({ kind: "system", label: "DOM Retry (Parse Failure)", data: { raw: action._rawContent } });
          try {
            const retryMsgs = buildDOMPrompt(goal, pageState, agentState.history, agentState.chatContext, agentState.lastThinking, personalInfoBlock);
            retryMsgs[retryMsgs.length - 1].content += "\n\n⚠️ YOUR LAST RESPONSE WAS NOT VALID JSON. You must respond with a strict JSON object only — no markdown, no prose, no code fences. Try again.";
            const retryAction = await callLLM(retryMsgs, agentState.model, "DOM-Retry", null);
            if (retryAction && !retryAction._parseFailed) {
              if (retryAction._thinking) agentState.lastThinking = retryAction._thinking;
              action = retryAction;
            } else {
              failReason = "DOM LLM returned unparseable response (retry also failed)";
            }
          } catch (err) {
            failReason = "DOM LLM retry error: " + err.message;
          }
        } else if (action && action._parseFailed) {
          if (!failReason) failReason = "DOM LLM returned unparseable response";
        }

        if (action && !action._parseFailed && !failReason) {
          // Pre-execution escalation check
          const preCheck = checkEscalation(action, null, prev, pageState);
          if (preCheck.should) {
            // Retryable triggers: hallucinated id (T3) and repeated action (T4)
            const isHallucinatedId = preCheck.reason.indexOf("non-existent element id") >= 0;
            const isRepeatedAction = preCheck.reason.indexOf("Agent repeated:") >= 0;
            if (isHallucinatedId || isRepeatedAction) {
              const retryLabel = isHallucinatedId ? "DOM Retry (Hallucinated ID)" : "DOM Retry (Repeated Action)";
              const retryFeedback = isHallucinatedId
                ? "\n\n⚠️ YOUR LAST RESPONSE USED ELEMENT ID " + action.id + " WHICH DOES NOT EXIST in the element list. ONLY use id values from the Interactive Elements list above. Try again."
                : "\n\n⚠️ YOUR LAST RESPONSE REPEATED AN ACTION ALREADY IN YOUR HISTORY: " + preCheck.reason.split(").")[0] + "). You MUST choose a DIFFERENT element or a DIFFERENT approach. Do NOT repeat the same action on the same target.";
              broadcastLog({ kind: "system", label: retryLabel, data: { id: action.id, reason: preCheck.reason } });
              try {
                const retryMsgs = buildDOMPrompt(goal, pageState, agentState.history, agentState.chatContext, agentState.lastThinking, personalInfoBlock);
                retryMsgs[retryMsgs.length - 1].content += retryFeedback;
                const retryAction = await callLLM(retryMsgs, agentState.model, "DOM-Retry", null);
                if (retryAction && !retryAction._parseFailed) {
                  if (retryAction._thinking) agentState.lastThinking = retryAction._thinking;
                  const retryPreCheck = checkEscalation(retryAction, null, prev, pageState);
                  if (!retryPreCheck.should) {
                    action = retryAction;
                  } else {
                    failReason = retryPreCheck.reason;
                    broadcastLog({ kind: "system", label: "Escalation (Pre-Exec after retry)", data: { trigger: retryPreCheck.reason } });
                  }
                } else {
                  failReason = preCheck.reason + " (retry also failed)";
                }
              } catch (err) {
                failReason = preCheck.reason + " (retry error: " + err.message + ")";
              }
            } else {
              failReason = preCheck.reason;
              broadcastLog({ kind: "system", label: "Escalation (Pre-Exec)", data: { trigger: preCheck.reason, domAction: action } });
            }
          }

          // Execute if no failReason (either pre-check passed, or retry succeeded)
          if (!failReason) {
            // Execute DOM action
            broadcastStatus({ status: "acting", message: "Step " + agentState.step + ": " + action.action });

            // Multi-step plan execution
            if (action.action === "plan" && Array.isArray(action.steps) && action.steps.length > 0) {
              const planSteps = action.steps.slice(0, 3);
              broadcastLog({ kind: "system", label: "Multi-step Plan", data: { steps: planSteps.length, reasoning: action.reasoning || "" } });

              for (let pi = 0; pi < planSteps.length; pi++) {
                if (agentState.aborted) break;
                const pa = planSteps[pi];
                if (!pa.action || pa.action === "plan" || pa.action === "done" || pa.action === "error") break;

                broadcastStatus({ status: "acting", message: "Step " + agentState.step + " (plan " + (pi + 1) + "/" + planSteps.length + "): " + pa.action });
                attachHints(pa, pageState);

                let pResult;
                try { pResult = await dispatchDOMAction(tabId, pa); }
                catch (err) { pResult = { success: false, error: err.message }; }

                broadcastLog({ kind: "execution", label: "Plan Step " + (pi + 1) + ": " + pa.action, data: { action: pa, result: pResult, mode: "planned" } });
                agentState.history.push(buildDOMHistoryEntry(pa, pResult, pageState));

                if (!pResult.success) {
                  broadcastLog({ kind: "system", label: "Plan Aborted", data: { step: pi + 1, error: pResult.error } });
                  break;
                }
                if (pi < planSteps.length - 1) {
                  await sleep(500);
                  try { pageState = await capturePageState(tabId); } catch { break; }
                }
              }
              tierResult = { action: { action: "plan" }, result: { success: true }, pageState: pageState };
            } else {
              // Single action execution
              attachHints(action, pageState);
              let result;
              try { result = await dispatchDOMAction(tabId, action); }
              catch (err) { result = { success: false, error: err.message }; }

              broadcastLog({ kind: "execution", label: "Executed: " + action.action, data: { action: action, result: result } });

              // Post-execution escalation check
              const postCheck = checkEscalation(action, result, prev, pageState);
              if (postCheck.should) {
                failReason = postCheck.reason;
                broadcastLog({ kind: "system", label: "Escalation (Post-Exec)", data: { trigger: postCheck.reason, failedAction: action } });
              } else if (!stepFailed(action, result)) {
                tierResult = { action: action, result: result, pageState: pageState };
              } else {
                failReason = (result && result.error) || "DOM action failed";
              }
            }
          }
        }
      } else if (pageState) {
        failReason = "0 interactive elements found";
        broadcastLog({ kind: "system", label: "0 Elements Found", data: { url: pageState.url } });
      }

      // Tier 1 success?
      if (tierResult) {
        const outcome = await handleTierSuccess(tierResult);
        if (outcome === "done" || outcome === "error") { shouldBreak = true; }
        if (!shouldBreak) continue;
      }
      if (shouldBreak) break;

      /* ═══════════════════════════════════════════
       * TIER 2: Vision + 80 SoM elements
       * ═══════════════════════════════════════════ */
      if (vm) {
        broadcastLog({ kind: "system", label: "Escalation → Vision (80)", data: { reason: failReason } });
        const v80 = await _attemptVisionOnce(tabId, goal, failReason, vm, 80);
        if (handleVisionDone(v80)) { shouldBreak = true; }
        else if (v80 && !stepFailed(v80.action, v80.result)) {
          tierResult = v80;
          tierResult._isVision = true;
        } else {
          failReason = (v80 && v80.action && v80.action.reason) || "Vision 80 failed";
          tierResult = null;
        }
      }

      if (tierResult && tierResult._isVision) {
        agentState.history.push(tierResult.historyEntry);
        const outcome = await handleTierSuccess(tierResult);
        if (outcome === "done" || outcome === "error") { shouldBreak = true; }
        if (!shouldBreak) continue;
      }
      if (shouldBreak) break;

      /* ═══════════════════════════════════════════
       * TIER 3: Vision + 160 SoM elements
       * ═══════════════════════════════════════════ */
      if (vm) {
        await sleep(1000);
        broadcastLog({ kind: "system", label: "Escalation → Vision (160)", data: { reason: failReason } });
        const v160 = await _attemptVisionOnce(tabId, goal, failReason, vm, 160);
        if (handleVisionDone(v160)) { shouldBreak = true; }
        else if (v160 && !stepFailed(v160.action, v160.result)) {
          tierResult = v160;
          tierResult._isVision = true;
        } else {
          failReason = (v160 && v160.action && v160.action.reason) || "Vision 160 failed";
          tierResult = null;
        }
      }

      if (tierResult && tierResult._isVision) {
        agentState.history.push(tierResult.historyEntry);
        const outcome = await handleTierSuccess(tierResult);
        if (outcome === "done" || outcome === "error") { shouldBreak = true; }
        if (!shouldBreak) continue;
      }
      if (shouldBreak) break;

      /* ═══════════════════════════════════════════
       * TIER 4: Raw screenshot + x/y coordinates (no SoM)
       * ═══════════════════════════════════════════ */
      if (vm) {
        await sleep(1000);
        broadcastLog({ kind: "system", label: "Escalation → Raw Coordinates", data: { reason: failReason } });
        const vRaw = await _attemptVisionOnce(tabId, goal, failReason, vm, 0);
        if (handleVisionDone(vRaw)) { shouldBreak = true; }
        else if (vRaw && !stepFailed(vRaw.action, vRaw.result)) {
          tierResult = vRaw;
          tierResult._isVision = true;
        } else {
          failReason = (vRaw && vRaw.action && vRaw.action.reason) || "Raw coordinate vision failed";
          tierResult = null;
        }
      }

      if (tierResult && tierResult._isVision) {
        agentState.history.push(tierResult.historyEntry);
        const outcome = await handleTierSuccess(tierResult);
        if (outcome === "done" || outcome === "error") { shouldBreak = true; }
        if (!shouldBreak) continue;
      }
      if (shouldBreak) break;

      /* ═══════════════════════════════════════════
       * ALL TIERS FAILED → STOP
       * ═══════════════════════════════════════════ */
      gracefulStop(goal, "All tiers exhausted at step " + agentState.step + ". " + failReason);
      break;
    }

    if (agentState.step >= agentState.maxSteps) {
      gracefulStop(goal, "Reached max steps (" + agentState.maxSteps + ").");
    }
    if (agentState.aborted) {
      await detachDebugger();
      broadcastLog({ kind: "system", label: "Aborted", data: {} });
      broadcastStatus({ status: "stopped", message: "Stopped by user." });
    }

  } catch (err) {
    broadcastLog({ kind: "error", label: "Unexpected Error", data: { error: err.message, stack: err.stack } });
    broadcastStatus({ status: "error", message: "Unexpected: " + err.message });
  } finally {
    agentState.running = false;
    await detachDebugger();  // Remove yellow debugger banner
    broadcastStatus({ status: "idle", message: "Agent idle." });
  }
}

/* ═══════════════════════════════════════════
 * MESSAGE HANDLER
 * ═══════════════════════════════════════════ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "START_AGENT": {
      if (agentState.running) { sendResponse({ success: false, error: "Already running." }); return true; }
      const goal = msg.goal;
      let tabId = msg.tabId;
      if (!goal || !tabId) { sendResponse({ success: false, error: "Missing goal or tabId." }); return true; }
      endChat(); // End any active chat session

      // Check if user wants this done in background
      const wantsBg = /\b(in\s*(the\s*)?background|background\s*tab|new\s*tab\s*(in\s*)?background|don'?t\s*switch|without\s*switching)\b/i.test(goal);

      loadConfig().then(async () => {
        if (wantsBg) {
          try {
            const newTab = await chrome.tabs.create({ url: "https://www.google.com", active: true });
            broadcastLog({
              kind: "system",
              label: "New Tab Created",
              data: { reason: "Goal requested background execution. New tab opened without switching.", tabId: newTab.id }
            });
            runAgentLoop(goal, newTab.id);
          } catch (err) {
            broadcastLog({ kind: "error", label: "Background Tab Failed", data: { error: err.message } });
            // Fall back to current tab
            runAgentLoop(goal, tabId);
          }
        } else {
          runAgentLoop(goal, tabId);
        }
        sendResponse({ success: true });
      });
      return true;
    }
    case "STOP_AGENT": {
      agentState.aborted = true;
      sendResponse({ success: true }); return true;
    }
    case "GET_STATUS": {
      sendResponse({
        running: agentState.running, step: agentState.step,
        maxSteps: agentState.maxSteps, goal: agentState.goal,
        history: agentState.history.slice(-5), logs: agentState.logs,
        chatActive: chatState.active
      }); return true;
    }
    case "SAVE_CONFIG": {
      saveConfig(msg.config).then(() => sendResponse({ success: true })); return true;
    }
    case "LOAD_CONFIG": {
      loadConfig().then(config => sendResponse({ success: true, config: config })); return true;
    }

    // ── Personal Info ──
    case "SAVE_PERSONAL_INFO": {
      chrome.storage.local.set({ [PERSONAL_INFO_KEY]: msg.info }).then(() => sendResponse({ success: true }));
      return true;
    }
    case "LOAD_PERSONAL_INFO": {
      chrome.storage.local.get(PERSONAL_INFO_KEY).then(r => sendResponse({ info: r[PERSONAL_INFO_KEY] || {} }));
      return true;
    }

    // ── Chat Mode Messages ──
    case "CHAT_INIT": {
      const tabId = msg.tabId;
      if (!tabId) { sendResponse({ success: false, error: "No tab ID." }); return true; }
      initChat(tabId).then(result => sendResponse(result));
      return true;
    }
    case "CHAT_MESSAGE": {
      const userMsg = msg.message;
      if (!userMsg) { sendResponse({ success: false, error: "Empty message." }); return true; }
      handleChatMessage(userMsg).then(result => sendResponse(result));
      return true;
    }
    case "CHAT_END": {
      resetAllState();
      sendResponse({ success: true }); return true;
    }

    // ── Chat Send (explicit chat mode) ──
    case "CHAT_SEND": {
      const text = msg.text;
      const tabId = msg.tabId;
      if (!text) { sendResponse({ success: false, error: "Empty message." }); return true; }

      (async () => {
        try {
          if (!chatState.active) {
            await loadConfig();
            const initResult = await initChat(tabId);
            if (!initResult.success) {
              sendResponse({ success: false, error: initResult.error });
              return;
            }
          }
          const result = await handleChatMessage(text);
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    // ── Agent Send (explicit agent mode) ──
    case "AGENT_SEND": {
      const text = msg.text;
      const tabId = msg.tabId;
      const useCurrentTab = msg.useCurrentTab || false;
      if (!text) { sendResponse({ success: false, error: "Empty message." }); return true; }
      if (agentState.running) { sendResponse({ success: false, error: "Agent is already running." }); return true; }

      (async () => {
        try {
          endChat();
          await loadConfig();

          if (useCurrentTab && tabId) {
            // Work on the current tab directly (e.g. user wants to interact with current page)
            runAgentLoop(text, tabId);
            sendResponse({ success: true, tabId: tabId });
          } else {
            // Create new tab for agent — google.com for content script injection,
            // agent will navigate directly to the relevant site on its first step.
            const newTab = await chrome.tabs.create({ url: "https://www.google.com", active: true });
            runAgentLoop(text, newTab.id);
            sendResponse({ success: true, tabId: newTab.id });
          }
        } catch (err) {
          // Fallback to current tab
          try {
            runAgentLoop(text, tabId);
            sendResponse({ success: true, tabId: tabId });
          } catch (e2) {
            sendResponse({ success: false, error: e2.message });
          }
        }
      })();
      return true;
    }

    // ── Intent Classification Query ──
    case "CLASSIFY_INTENT": {
      const { intent } = classifyIntent(msg.text || "");
      sendResponse({ intent });
      return true;
    }

    // ══════════════════════════════════════════
    // Workflow Recording & Replay Messages
    // ══════════════════════════════════════════

    case "WF_START_RECORDING": {
      const tabId = msg.tabId;
      if (!tabId) { sendResponse({ success: false, error: "No tab ID." }); return true; }
      if (agentState.running || workflowState.replaying) {
        sendResponse({ success: false, error: "Agent or replay is running." }); return true;
      }
      wfStartRecording(tabId).then(() => sendResponse({ success: true })).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }

    case "WF_STOP_RECORDING": {
      const name = msg.name || null;
      const paramNames = msg.paramNames || {}; // { stepIndex: "friendly name" }
      wfStopRecording(name, paramNames).then(wf => sendResponse({ success: true, workflow: wf })).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }

    case "RECORD_ACTION": {
      if (!workflowState.recording) return;
      const step = msg.step;
      const recording = workflowState.currentRecording;

      // Dedup: consecutive type on same element → replace last instead of appending
      if (step.action === "type" && recording.length > 0) {
        const last = recording[recording.length - 1];
        if (last.action === "type" && isSameElement(last.fingerprint, step.fingerprint)) {
          step.index = last.index;
          recording[recording.length - 1] = step;
          chrome.runtime.sendMessage({
            type: "WORKFLOW_STATUS", recording: true,
            stepCount: recording.length, latestStep: step.description || ""
          }).catch(() => {});
          return;
        }
      }

      // Dedup: consecutive navigate to same URL → skip
      if (step.action === "navigate" && recording.length > 0) {
        const last = recording[recording.length - 1];
        if (last.action === "navigate" && last.url === step.url) {
          return;
        }
      }

      step.index = recording.length;
      recording.push(step);
      chrome.runtime.sendMessage({
        type: "WORKFLOW_STATUS", recording: true,
        stepCount: recording.length, latestStep: step.description || ""
      }).catch(() => {});
      return;
    }

    case "WF_LIST": {
      loadWorkflows().then(wfs => sendResponse({ success: true, workflows: wfs }));
      return true;
    }

    case "WF_DELETE": {
      deleteWorkflow(msg.workflowId).then(() => sendResponse({ success: true }));
      return true;
    }

    case "WF_RENAME": {
      (async () => {
        const wfs = await loadWorkflows();
        const wf = wfs.find(w => w.id === msg.workflowId);
        if (wf) {
          wf.name = msg.name;
          wf.updatedAt = new Date().toISOString();
          await chrome.storage.local.set({ [WORKFLOWS_KEY]: wfs });
        }
        sendResponse({ success: true });
      })();
      return true;
    }

    case "WF_REMOVE_STEP": {
      (async () => {
        const wfs = await loadWorkflows();
        const wf = wfs.find(w => w.id === msg.workflowId);
        if (!wf) { sendResponse({ success: false, error: "Not found" }); return; }
        wf.steps.splice(msg.stepIndex, 1);
        wf.steps.forEach((s, i) => s.index = i);
        wf.params = (wf.params || [])
          .filter(p => p.stepIndex !== msg.stepIndex)
          .map(p => ({ ...p, stepIndex: p.stepIndex > msg.stepIndex ? p.stepIndex - 1 : p.stepIndex }));
        wf.updatedAt = new Date().toISOString();
        await chrome.storage.local.set({ [WORKFLOWS_KEY]: wfs });
        sendResponse({ success: true });
      })();
      return true;
    }

    case "WF_EDIT_STEP": {
      (async () => {
        const wfs = await loadWorkflows();
        const wf = wfs.find(w => w.id === msg.workflowId);
        if (!wf || !wf.steps[msg.stepIndex]) { sendResponse({ success: false, error: "Not found" }); return; }
        const step = wf.steps[msg.stepIndex];
        step.value = msg.newValue;
        if (step.action === "navigate") { step.url = msg.newValue; step.description = "Navigate to " + msg.newValue; }
        else if (step.action === "type") { step.description = "Type '" + msg.newValue + "'" + (step.fingerprint && step.fingerprint.placeholder ? " in " + step.fingerprint.placeholder : ""); }
        const param = (wf.params || []).find(p => p.stepIndex === msg.stepIndex);
        if (param) param.defaultValue = msg.newValue;
        wf.updatedAt = new Date().toISOString();
        await chrome.storage.local.set({ [WORKFLOWS_KEY]: wfs });
        sendResponse({ success: true });
      })();
      return true;
    }

    case "WF_REPLAY": {
      if (agentState.running || workflowState.recording || workflowState.replaying) {
        sendResponse({ success: false, error: "Agent, recording, or replay already running." }); return true;
      }
      wfReplayWorkflow(msg.workflowId, msg.tabId, msg.paramValues || {});
      sendResponse({ success: true });
      return true;
    }

    case "WF_STOP_REPLAY": {
      workflowState.replayAborted = true;
      sendResponse({ success: true });
      return true;
    }

    case "WF_RESUME_REPLAY": {
      workflowState.replayPaused = false;
      sendResponse({ success: true });
      return true;
    }

    case "WF_GET_PARAMS": {
      // Return the parameterizable steps for a workflow (for param form)
      (async () => {
        const wfs = await loadWorkflows();
        const wf = wfs.find(w => w.id === msg.workflowId);
        if (!wf) { sendResponse({ success: false, error: "Not found" }); return; }
        const params = (wf.params || []).map(p => ({
          stepIndex: p.stepIndex,
          paramName: p.paramName,
          defaultValue: p.defaultValue,
          description: p.description
        }));
        sendResponse({ success: true, params, workflowName: wf.name });
      })();
      return true;
    }

    // ══════════════════════════════════════════
    // Research Mode Messages
    // ══════════════════════════════════════════

    case "RESEARCH_START": {
      const query = msg.query;
      if (!query) { sendResponse({ error: "Empty query." }); return true; }
      if (researchState.running) { sendResponse({ error: "Research already running." }); return true; }
      if (agentState.running) { sendResponse({ error: "Agent is running. Wait for it to finish." }); return true; }
      (async () => {
        try {
          await loadConfig();
          runResearchPipeline(query);
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }
    case "RESEARCH_ABORT": {
      researchState.aborted = true;
      if (researchState.abortController) researchState.abortController.abort();
      // Kill the research tab immediately so navigation stops
      if (researchState.tabId) {
        chrome.tabs.remove(researchState.tabId).catch(() => {});
        researchState.tabId = null;
      }
      sendResponse({ success: true });
      return true;
    }
    case "RESEARCH_LIST_REPORTS": {
      (async () => {
        const reports = await loadResearchReports();
        sendResponse({ reports: reports.map(r => ({ id: r.id, query: r.query, createdAt: r.createdAt, status: r.status, sources: r.sources ? r.sources.map(s => ({ sourceName: s.sourceName })) : [] })) });
      })();
      return true;
    }
    case "RESEARCH_VIEW_REPORT": {
      (async () => {
        const reports = await loadResearchReports();
        const rpt = reports.find(r => r.id === msg.id);
        if (!rpt || !rpt.htmlReport) { sendResponse({ error: "Report not found." }); return; }
        const encoded = btoa(unescape(encodeURIComponent(rpt.htmlReport)));
        await chrome.tabs.create({ url: "data:text/html;base64," + encoded });
        sendResponse({ success: true });
      })();
      return true;
    }
    case "RESEARCH_DELETE_REPORT": {
      (async () => {
        await deleteResearchReport(msg.id);
        sendResponse({ success: true });
      })();
      return true;
    }
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ═══════════════════════════════════════════
 * RESEARCH MODE — Pipeline & Storage
 * ═══════════════════════════════════════════ */

async function loadResearchReports() {
  try {
    const result = await chrome.storage.local.get(RESEARCH_KEY);
    return result[RESEARCH_KEY] || [];
  } catch { return []; }
}

async function saveResearchReport(report) {
  const reports = await loadResearchReports();
  reports.push(report);
  const trimmed = reports.length > MAX_RESEARCH_REPORTS ? reports.slice(reports.length - MAX_RESEARCH_REPORTS) : reports;
  await chrome.storage.local.set({ [RESEARCH_KEY]: trimmed });
}

async function deleteResearchReport(id) {
  const reports = await loadResearchReports();
  const filtered = reports.filter(r => r.id !== id);
  await chrome.storage.local.set({ [RESEARCH_KEY]: filtered });
}

function broadcastResearchProgress() {
  chrome.runtime.sendMessage({
    type: "RESEARCH_PROGRESS",
    sources: researchState.sources.map(s => ({ name: s.name, status: s.status, statusText: s.statusText }))
  }).catch(() => {});
}

function broadcastResearchStatus(status, message, reportId) {
  chrome.runtime.sendMessage({
    type: "RESEARCH_STATUS",
    status: status,
    message: message || "",
    reportId: reportId || null
  }).catch(() => {});
}

function resetResearchState() {
  researchState.running = false;
  researchState.aborted = false;
  researchState.query = "";
  researchState.tabId = null;
  researchState.sources = [];
  researchState.results = [];
  researchState.currentSourceIndex = 0;
  researchState.reportId = null;
  researchState.visitedUrls = new Set();
  researchState.abortController = null;
}

// Returns a promise that rejects instantly when abort is signalled.
// Race any blocking operation against this to make it cancellable.
function researchAbortSignal() {
  if (!researchState.abortController) return new Promise(() => {}); // never resolves
  return new Promise((_, reject) => {
    if (researchState.abortController.signal.aborted) { reject(new Error("aborted")); return; }
    researchState.abortController.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

// Abort-aware sleep — resolves after ms OR rejects instantly on abort
function researchSleep(ms) {
  return Promise.race([
    new Promise(r => setTimeout(r, ms)),
    researchAbortSignal()
  ]);
}


async function runResearchPipeline(query) {
  resetResearchState();
  researchState.running = true;
  researchState.abortController = new AbortController();
  researchState.query = query;
  researchState.reportId = "res_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

  // Helper: race any promise against the abort signal
  function raceAbort(p) { return Promise.race([p, researchAbortSignal()]); }

  let tab;
  try {
    tab = await chrome.tabs.create({ url: "about:blank", active: true });
    researchState.tabId = tab.id;
  } catch (err) {
    broadcastResearchStatus("error", "Failed to create tab: " + err.message);
    resetResearchState();
    return;
  }

  const encodedQuery = encodeURIComponent(query);

  /* ─── Phase 1: Google Search — screenshot AI summary + extract top 10 URLs ─── */
  researchState.sources = [{ name: "Google Search", url: "https://www.google.com/search?q=" + encodedQuery, status: "active", statusText: "Searching..." }];
  broadcastResearchProgress();

  let googleResultUrls = [];
  try {
    await raceAbort(chrome.tabs.update(researchState.tabId, { url: "https://www.google.com/search?q=" + encodedQuery }));
    await raceAbort(waitForTabLoad(researchState.tabId, 30000));
    await researchSleep(2000);

    // Screenshot the Google page → vision LLM for overview summary
    let googleSummaryText = "";
    try {
      const screenshot = await raceAbort(captureScreenshot(researchState.tabId));
      if (screenshot) {
        researchState.sources[0].statusText = "Summarizing...";
        broadcastResearchProgress();
        const visionPrompt = [
          { role: "system", content: "You summarize Google search results pages. Focus on the AI Overview/summary at the top if present, plus the key information visible." },
          { role: "user", content: `Summarize the overview and key information from this Google search results page about "${query}". Be concise (3-5 sentences).` }
        ];
        const visionResult = await raceAbort(callLLM(visionPrompt, agentState.researchModel, "ResearchGoogleVision", screenshot, { forceJson: false, timeout: 45000 }));
        googleSummaryText = visionResult._rawContent || visionResult.content || "";
      }
    } catch (ex) {
      if (researchState.aborted) throw ex;
      /* vision failed */
    }

    if (researchState.aborted) throw new Error("aborted");

    // Extract SERP text for URL extraction
    await raceAbort(ensureContentScript(researchState.tabId));
    const summary = await raceAbort(capturePageSummary(researchState.tabId));
    const serpText = typeof summary === "string" ? summary : (summary.text || summary.content || JSON.stringify(summary));

    // Store Google overview as the first source result
    researchState.results.push({
      url: "https://www.google.com/search?q=" + encodedQuery,
      title: "Google Search Overview",
      sourceName: "Google Search",
      summary: googleSummaryText || serpText.slice(0, 1000),
      extractionMethod: googleSummaryText ? "vision" : "text",
      timestamp: new Date().toISOString()
    });

    // Extract top 10 result URLs directly from Google DOM (not LLM — text has no URLs)
    try {
      const [{ result: domLinks }] = await raceAbort(chrome.scripting.executeScript({
        target: { tabId: researchState.tabId },
        func: () => {
          const results = [];
          const seen = new Set();
          document.querySelectorAll("div.g").forEach(g => {
            const a = g.querySelector("a[href]");
            const h3 = g.querySelector("h3");
            if (a && a.href && a.href.startsWith("http") && !a.href.includes("google.com")) {
              if (!seen.has(a.href)) {
                seen.add(a.href);
                results.push({ url: a.href, title: h3 ? h3.textContent.trim() : "" });
              }
            }
          });
          if (results.length < 5) {
            document.querySelectorAll("a[href]").forEach(a => {
              const h3 = a.querySelector("h3");
              if (h3 && a.href.startsWith("http") && !a.href.includes("google.com") && !seen.has(a.href)) {
                seen.add(a.href);
                results.push({ url: a.href, title: h3.textContent.trim() });
              }
            });
          }
          return results.slice(0, 10);
        }
      }));
      if (domLinks && domLinks.length > 0) {
        googleResultUrls = domLinks;
      }
    } catch (ex) {
      if (researchState.aborted) throw ex;
      /* DOM extraction failed */
    }

    researchState.sources[0].status = "done";
    researchState.sources[0].statusText = "Done";
    researchState.visitedUrls.add("https://www.google.com/search?q=" + encodedQuery);
  } catch (err) {
    if (researchState.aborted) { await finalizeResearch(); return; }
    researchState.sources[0].status = "error";
    researchState.sources[0].statusText = err.message.slice(0, 40);
  }
  broadcastResearchProgress();

  if (researchState.aborted) { await finalizeResearch(); return; }

  /* ─── Phase 2: Visit top 10 Google results ─── */
  googleResultUrls.forEach((r, i) => {
    researchState.sources.push({
      name: r.title ? r.title.slice(0, 80) : "Result #" + (i + 1),
      url: r.url, status: "pending", statusText: "Pending"
    });
  });
  broadcastResearchProgress();

  for (let i = 0; i < googleResultUrls.length; i++) {
    if (researchState.aborted) break;

    const src = googleResultUrls[i];
    const sourceIdx = i + 1; // +1 because Google SERP is index 0
    researchState.sources[sourceIdx].status = "active";
    researchState.sources[sourceIdx].statusText = "Opening page...";
    broadcastResearchProgress();

    try {
      await Promise.race([
        (async () => {
          researchState.visitedUrls.add(src.url);

          // All awaits race against both the 60s hard timeout AND the abort signal
          await raceAbort(chrome.tabs.update(researchState.tabId, { url: src.url }));
          await raceAbort(waitForTabLoad(researchState.tabId, 15000));
          await researchSleep(1500);

          // Scrape text
          researchState.sources[sourceIdx].statusText = "Scraping text...";
          broadcastResearchProgress();

          let extractedText = "";
          let extractionMethod = "text";

          try {
            await raceAbort(ensureContentScript(researchState.tabId));
            const pageSummary = await raceAbort(capturePageSummary(researchState.tabId));
            extractedText = typeof pageSummary === "string" ? pageSummary : (pageSummary.text || pageSummary.content || JSON.stringify(pageSummary));
          } catch (ex) {
            if (researchState.aborted) throw ex;
            extractedText = "";
          }

          extractedText = extractedText.slice(0, 2500);
          if (researchState.aborted) throw new Error("aborted");

          // If text is sparse (<100 chars), try screenshot + vision
          if (extractedText.trim().length < 100) {
            researchState.sources[sourceIdx].statusText = "Low text, capturing screenshot...";
            broadcastResearchProgress();
            try {
              const screenshot = await raceAbort(captureScreenshot(researchState.tabId));
              if (screenshot && (agentState.visionModel || agentState.model)) {
                extractionMethod = "vision";
                researchState.sources[sourceIdx].statusText = "Sent to vision LLM...";
                broadcastResearchProgress();
                const visionPrompt = [
                  { role: "system", content: "You extract and summarize the main content visible on this web page screenshot." },
                  { role: "user", content: `Describe the main content of this page relevant to the research query: "${query}". Focus on factual information, key points, and notable details.` }
                ];
                const visionResult = await raceAbort(callLLM(visionPrompt, agentState.researchModel, "ResearchVision", screenshot, { forceJson: false, timeout: 45000 }));
                extractedText = visionResult._rawContent || visionResult.content || extractedText;
              }
            } catch (ex) {
              if (researchState.aborted) throw ex;
              /* vision failed, continue with whatever text we have */
            }
          }

          if (researchState.aborted) throw new Error("aborted");

          // Skip if still no meaningful content
          if (extractedText.trim().length < 30) {
            researchState.sources[sourceIdx].status = "error";
            researchState.sources[sourceIdx].statusText = "No content";
            broadcastResearchProgress();
            return;
          }

          // Summarize this source
          const charCount = extractedText.trim().length;
          researchState.sources[sourceIdx].statusText = "Scraped " + charCount + " chars, sent to LLM...";
          broadcastResearchProgress();

          const summarizePrompt = [
            { role: "system", content: "You are a research assistant. Summarize the following web page content in detail, focusing on information relevant to the research query. Include key facts, dates, names, statistics, and notable details. Be factual and objective." },
            { role: "user", content: `Research query: "${query}"\nSource: ${src.title || src.url}\n\nPage content:\n${extractedText}\n\nProvide a detailed summary of 15-25 lines covering all the important information from this source relevant to the research query.` }
          ];

          researchState.sources[sourceIdx].statusText = "Waiting for summary...";
          broadcastResearchProgress();

          const summaryResult = await raceAbort(callLLM(summarizePrompt, agentState.researchModel, "ResearchSummary", null, { forceJson: false, timeout: 45000 }));
          const summaryText = summaryResult._rawContent || summaryResult.content || "";

          researchState.results.push({
            url: src.url,
            title: src.title || "Result #" + (i + 1),
            sourceName: src.title || "Result #" + (i + 1),
            summary: summaryText,
            extractionMethod: extractionMethod,
            timestamp: new Date().toISOString()
          });

          researchState.sources[sourceIdx].status = "done";
          researchState.sources[sourceIdx].statusText = "Done";
        })(),
        // Hard 60s timeout per source
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout (60s)")), 60000)),
        // Abort signal — rejects instantly when user clicks abort
        researchAbortSignal()
      ]);
    } catch (err) {
      if (researchState.aborted) {
        researchState.sources[sourceIdx].status = "error";
        researchState.sources[sourceIdx].statusText = "Aborted";
        break;
      }
      researchState.sources[sourceIdx].status = "error";
      researchState.sources[sourceIdx].statusText = err.message.slice(0, 40);
    }

    broadcastResearchProgress();
    try { await researchSleep(500); } catch { break; } // break if aborted during gap
  }

  await finalizeResearch();
}

async function finalizeResearch() {
  const report = {
    id: researchState.reportId,
    query: researchState.query,
    createdAt: new Date().toISOString(),
    status: researchState.aborted ? "aborted" : "done",
    sources: researchState.results,
    conclusion: ""
  };

  // Synthesize a final conclusion from all source summaries (skip if aborted)
  if (researchState.results.length > 0 && !researchState.aborted) {
    researchState.sources.push({ name: "Generating Conclusion", url: "", status: "active", statusText: "Synthesizing..." });
    broadcastResearchProgress();

    try {
      let allSummaries = "";
      researchState.results.forEach(function(s, i) {
        allSummaries += "Source " + (i + 1) + " (" + (s.title || s.sourceName || s.url) + "):\n" + (s.summary || "No summary.") + "\n\n";
      });
      allSummaries = allSummaries.slice(0, 8000);

      const conclusionPrompt = [
        { role: "system", content: "You are a research analyst. Given multiple source summaries about a topic, write a comprehensive final conclusion. Structure it with clear paragraphs. Cover: key findings, common themes, notable details, and any conflicting information. Be factual, thorough, and well-organized. Use markdown formatting (bold for key terms, bullet lists where appropriate)." },
        { role: "user", content: 'Research query: "' + researchState.query + '"\n\nSource summaries:\n' + allSummaries + "\nWrite a comprehensive conclusion synthesizing all the above sources. 15-25 lines." }
      ];

      // Race conclusion LLM call against abort signal
      const conclusionResult = await Promise.race([
        callLLM(conclusionPrompt, agentState.researchModel, "ResearchConclusion", null, { forceJson: false, timeout: 45000 }),
        researchAbortSignal()
      ]);
      report.conclusion = conclusionResult._rawContent || conclusionResult.content || "";

      researchState.sources[researchState.sources.length - 1].status = "done";
      researchState.sources[researchState.sources.length - 1].statusText = "Done";
    } catch {
      researchState.sources[researchState.sources.length - 1].status = "error";
      researchState.sources[researchState.sources.length - 1].statusText = researchState.aborted ? "Aborted" : "Failed";
    }
    broadcastResearchProgress();
  }

  report.htmlReport = generateResearchHTML(report);
  await saveResearchReport(report);

  // Open report in new tab
  try {
    const encoded = btoa(unescape(encodeURIComponent(report.htmlReport)));
    await chrome.tabs.create({ url: "data:text/html;base64," + encoded });
  } catch { /* tab creation failed */ }

  // Clean up research tab
  try {
    if (researchState.tabId) await chrome.tabs.remove(researchState.tabId);
  } catch { /* tab may already be closed */ }

  const status = researchState.aborted ? "aborted" : "done";
  const reportId = researchState.reportId;
  broadcastResearchStatus(status, status === "done" ? "Research complete" : "Research aborted", reportId);
  resetResearchState();
}

/* ── HTML Report Generator ── */
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function summaryToHtml(text) {
  if (!text) return "<p>No summary available.</p>";
  return text.split(/\n\n+/).map(function(block) {
    block = block.trim();
    if (!block) return "";
    block = escapeHtml(block);
    block = block.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    block = block.replace(/\*(.+?)\*/g, "<em>$1</em>");
    if (/^[-•]\s/.test(block)) {
      var items = block.split(/\n/).map(function(l) {
        return "<li>" + l.replace(/^[-•]\s*/, "") + "</li>";
      }).join("");
      return "<ul>" + items + "</ul>";
    }
    block = block.replace(/\n/g, "<br>");
    return "<p>" + block + "</p>";
  }).join("");
}

function generateResearchHTML(report) {
  const q = escapeHtml(report.query);
  const date = new Date(report.createdAt).toLocaleString();
  const sourceCount = report.sources ? report.sources.length : 0;

  // Separate Google overview from other sources
  let googleOverview = null;
  const otherSources = [];
  (report.sources || []).forEach(function(s) {
    if (s.sourceName === "Google Search" || s.sourceName === "Google Search Overview") {
      googleOverview = s;
    } else {
      otherSources.push(s);
    }
  });

  // Conclusion section (synthesized from all sources)
  let conclusionHtml = "";
  if (report.conclusion) {
    conclusionHtml = `
      <section class="conclusion">
        <div class="section-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Final Conclusion</div>
        <div class="conclusion-body">${summaryToHtml(report.conclusion)}</div>
      </section>`;
  }

  // Google overview section
  let overviewHtml = "";
  if (googleOverview && googleOverview.summary) {
    overviewHtml = `
      <section class="overview">
        <div class="section-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Google AI Overview</div>
        <div class="prose">${summaryToHtml(googleOverview.summary)}</div>
      </section>`;
  }

  // Source cards for masonry grid
  let sourceCards = "";
  otherSources.forEach(function(s, i) {
    const title = escapeHtml(s.title || s.sourceName || "Source " + (i + 1));
    const url = escapeHtml(s.url || "");
    const bodyHtml = summaryToHtml(s.summary);
    const method = s.extractionMethod === "vision"
      ? '<span class="badge vision">Vision</span>'
      : '<span class="badge text">Text</span>';
    sourceCards += `
      <article class="card">
        <header class="card-head">
          <span class="card-num">${i + 1}</span>
          <div class="card-meta">
            <a class="card-title" href="${url}" target="_blank" rel="noopener">${title}</a>
            <div class="card-url">${url}</div>
          </div>
          ${method}
        </header>
        <div class="card-body prose">${bodyHtml}</div>
      </article>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Research: ${q}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <style>
    :root {
      --accent: #7c6aef; --accent-light: #a78bfa; --accent-dim: rgba(124,106,239,0.10);
      --bg: #f4f5f9; --bg-card: #ffffff; --bg-header: #111019;
      --text: #1c1c2e; --text-body: #374151; --muted: #8b8da6;
      --border: #e5e7eb; --radius: 16px;
      --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
      --font-serif: "Source Serif 4", "Georgia", "Times New Roman", serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0b14; --bg-card: #151522; --bg-header: #0b0b14;
        --text: #e8e9f0; --text-body: #c0c3d0; --muted: #6b6d82;
        --border: #262638;
      }
    }
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-sans);
      background: var(--bg); color: var(--text);
      line-height: 1.65; min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }

    /* ── Header ── */
    .header {
      background: var(--bg-header); color: #fff;
      padding: 60px 32px 52px; text-align: center;
      position: relative;
    }
    .header::after {
      content: ""; position: absolute; bottom: 0; left: 0; right: 0; height: 3px;
      background: linear-gradient(90deg, var(--accent), var(--accent-light), var(--accent));
    }
    .header h1 {
      font-family: var(--font-sans);
      font-size: 2.4em; font-weight: 800; letter-spacing: -0.03em;
      line-height: 1.15; margin-bottom: 8px;
    }
    .header .sub { font-size: 0.88em; color: rgba(255,255,255,0.4); font-weight: 400; }

    /* ── Container ── */
    .wrap { max-width: 1200px; margin: 0 auto; padding: 0 28px 72px; }

    /* ── Stats bar ── */
    .stats {
      display: flex; gap: 12px; justify-content: center;
      margin: -22px auto 36px; position: relative; z-index: 1;
    }
    .stat {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 12px; padding: 12px 22px; text-align: center;
      min-width: 110px; box-shadow: 0 1px 8px rgba(0,0,0,0.04);
    }
    .stat b { display: block; font-size: 1.4em; font-weight: 700; color: var(--accent); }
    .stat small {
      font-size: 0.68em; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.8px; font-weight: 600;
    }

    /* ── Section labels ── */
    .section-label {
      display: flex; align-items: center; gap: 7px;
      font-size: 0.72em; font-weight: 700; color: var(--accent);
      text-transform: uppercase; letter-spacing: 1px;
      margin-bottom: 14px; padding-bottom: 10px;
      border-bottom: 2px solid var(--accent);
    }
    .section-label svg { flex-shrink: 0; }

    /* ── Prose (shared text styling) ── */
    .prose {
      font-family: var(--font-serif);
      font-size: 0.95em; color: var(--text-body);
      line-height: 1.9; letter-spacing: 0.006em;
    }
    .prose p { margin-bottom: 12px; }
    .prose p:last-child { margin-bottom: 0; }
    .prose strong { color: var(--text); font-weight: 600; }
    .prose em { font-style: italic; }
    .prose ul, .prose ol { margin: 8px 0 12px 22px; }
    .prose li { margin-bottom: 5px; }

    /* ── Conclusion ── */
    .conclusion {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 28px 32px;
      margin-bottom: 32px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.04);
      border-top: 4px solid var(--accent);
    }
    .conclusion .conclusion-body {
      font-family: var(--font-serif);
      font-size: 1em; color: var(--text-body);
      line-height: 1.95; letter-spacing: 0.006em;
    }
    .conclusion .conclusion-body p { margin-bottom: 14px; }
    .conclusion .conclusion-body p:last-child { margin-bottom: 0; }
    .conclusion .conclusion-body strong { color: var(--text); font-weight: 600; }
    .conclusion .conclusion-body ul, .conclusion .conclusion-body ol { margin: 8px 0 14px 24px; }
    .conclusion .conclusion-body li { margin-bottom: 6px; line-height: 1.8; }

    /* ── Google overview ── */
    .overview {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 24px 28px;
      margin-bottom: 32px; box-shadow: 0 1px 8px rgba(0,0,0,0.04);
      border-left: 4px solid var(--accent);
    }

    /* ── Multi-column masonry grid ── */
    .grid-label {
      font-size: 0.72em; font-weight: 700; color: var(--accent);
      text-transform: uppercase; letter-spacing: 1px;
      margin-bottom: 18px; padding-bottom: 10px;
      border-bottom: 2px solid var(--accent);
      display: flex; align-items: center; gap: 7px;
    }
    .masonry {
      columns: 2; column-gap: 20px;
    }
    .card {
      break-inside: avoid;
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 20px 22px;
      margin-bottom: 20px;
      box-shadow: 0 1px 6px rgba(0,0,0,0.04);
      transition: box-shadow 0.2s, border-color 0.2s;
      display: inline-block; width: 100%;
    }
    .card:hover {
      box-shadow: 0 4px 20px rgba(124,106,239,0.1);
      border-color: rgba(124,106,239,0.35);
    }
    .card-head {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 12px; padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .card-num {
      width: 26px; height: 26px; border-radius: 50%;
      background: var(--accent); color: #fff;
      font-size: 0.72em; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .card-meta { flex: 1; min-width: 0; }
    .card-title {
      font-family: var(--font-sans);
      font-size: 0.88em; font-weight: 600; color: var(--accent);
      text-decoration: none; display: block;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .card-title:hover { text-decoration: underline; }
    .card-url {
      font-family: var(--font-sans);
      font-size: 0.68em; color: var(--muted); margin-top: 2px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .badge {
      font-family: var(--font-sans);
      font-size: 0.58em; font-weight: 600; padding: 2px 7px;
      border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .badge.text { background: var(--accent-dim); color: var(--accent); }
    .badge.vision { background: rgba(251,191,36,0.15); color: #b45309; }
    .card-body.prose { font-size: 0.88em; line-height: 1.82; }
    .card-body.prose p { margin-bottom: 8px; }

    /* ── Footer ── */
    .footer {
      text-align: center; padding: 28px 0; margin-top: 44px;
      border-top: 1px solid var(--border);
      font-size: 0.78em; color: var(--muted);
    }
    .footer strong { color: var(--accent); }

    /* ── Print ── */
    @media print {
      body { background: #fff; color: #111; }
      .header { background: #111; }
      .masonry { columns: 2; }
      .card { box-shadow: none; break-inside: avoid; border: 1px solid #ddd; }
      .conclusion, .overview { box-shadow: none; }
    }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .masonry { columns: 1; }
    }
    @media (max-width: 600px) {
      .header h1 { font-size: 1.5em; }
      .header { padding: 36px 16px 32px; }
      .stats { flex-direction: column; align-items: center; }
      .wrap { padding: 0 14px 40px; }
      .conclusion, .overview { padding: 18px 20px; }
      .card { padding: 16px 18px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${q}</h1>
    <div class="sub">Research Report &mdash; WebWright</div>
  </div>
  <div class="wrap">
    <div class="stats">
      <div class="stat"><b>${sourceCount}</b><small>Sources</small></div>
      <div class="stat"><b>${date.split(",")[0] || date}</b><small>Date</small></div>
      <div class="stat"><b>${report.status === "done" ? "Complete" : "Partial"}</b><small>Status</small></div>
    </div>
    ${conclusionHtml}
    ${overviewHtml}
    <div class="grid-label"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> Source Summaries</div>
    <div class="masonry">
      ${sourceCards}
    </div>
    <div class="footer">Generated by <strong>WebWright</strong> Research Mode</div>
  </div>
</body>
</html>`;
}

/* ───────────────────────────────────────────
 * Workflow Recording Control
 * ─────────────────────────────────────────── */

async function wfStartRecording(tabId) {
  workflowState.recording = true;
  workflowState.recordingTabId = tabId;
  workflowState.currentRecording = [];

  // Navigate to google.com first
  await chrome.tabs.update(tabId, { url: "https://www.google.com" });
  await waitForTabLoad(tabId, 15000);
  await sleep(1000);

  // Inject and start recording in content script
  await ensureContentScript(tabId);
  await sendToTabRobust(tabId, { type: "START_RECORDING" });

  broadcastLog({ kind: "system", label: "Recording Started — interact with pages to capture actions" });
  chrome.runtime.sendMessage({ type: "WORKFLOW_STATUS", recording: true, stepCount: 0 }).catch(() => {});
}

async function wfStopRecording(workflowName, paramNames) {
  if (!workflowState.recording) return null;

  try {
    await sendToTabRobust(workflowState.recordingTabId, { type: "STOP_RECORDING" });
  } catch {} // content script may have navigated away

  // Build params array from type steps
  const params = [];
  workflowState.currentRecording.forEach((step, i) => {
    if (step.isParam && step.value) {
      const friendlyName = (paramNames && paramNames[i]) || ("param_" + (params.length + 1));
      params.push({
        stepIndex: i,
        paramName: friendlyName,
        defaultValue: step.value,
        description: step.description || ""
      });
      step.paramName = friendlyName;
    }
  });

  const workflow = {
    id: "wf_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    name: workflowName || "Workflow " + new Date().toLocaleString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startUrl: "https://www.google.com",
    params,
    steps: workflowState.currentRecording
  };

  await saveWorkflow(workflow);

  workflowState.recording = false;
  workflowState.recordingTabId = null;
  workflowState.currentRecording = [];

  broadcastLog({ kind: "system", label: "Workflow Saved: " + workflow.name + " (" + workflow.steps.length + " steps)" });
  chrome.runtime.sendMessage({ type: "WORKFLOW_STATUS", recording: false }).catch(() => {});

  return workflow;
}

// Re-inject recording listeners after page navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (workflowState.recording && tabId === workflowState.recordingTabId && changeInfo.status === "complete") {
    const recording = workflowState.currentRecording;

    // Dedup: skip if last step is already a navigate to this URL
    const last = recording.length > 0 ? recording[recording.length - 1] : null;
    if (!last || last.action !== "navigate" || last.url !== tab.url) {
      recording.push({
        index: recording.length,
        action: "navigate",
        url: tab.url,
        timestamp: Date.now(),
        pageUrl: tab.url,
        pageTitle: tab.title || "",
        fingerprint: null,
        value: null,
        description: "Navigate to " + (tab.url || "")
      });
    }

    // Re-enable recording on new page
    sleep(500).then(() => {
      ensureContentScript(tabId).then(() => {
        sendToTabRobust(tabId, { type: "START_RECORDING" }).catch(() => {});
      }).catch(() => {});
    });

    chrome.runtime.sendMessage({
      type: "WORKFLOW_STATUS",
      recording: true,
      stepCount: workflowState.currentRecording.length,
      latestStep: "Navigated to " + (tab.url || "")
    }).catch(() => {});
  }
});

/* ───────────────────────────────────────────
 * Workflow Replay Engine — 2-Step: Exact Replay → Agent Fallback
 * ─────────────────────────────────────────── */

// Build action object, substituting param values if applicable
function buildReplayAction(recordedStep, paramValues) {
  const action = {
    action: recordedStep.action,
    selector: recordedStep.fingerprint?.selectors?.cssPath || null
  };
  // Try selectors in order: id > cssPath > first data-attribute
  const fp = recordedStep.fingerprint;
  if (fp && fp.selectors) {
    if (fp.selectors.id) action.selector = "#" + fp.selectors.id;
    else if (fp.selectors.cssPath) action.selector = fp.selectors.cssPath;
    else {
      const dataAttrs = fp.selectors.dataAttributes || {};
      for (const [attr, val] of Object.entries(dataAttrs)) {
        if (attr !== "data-agent-id") { action.selector = `[${attr}="${val}"]`; break; }
      }
    }
  }
  // Substitute parameterized value if provided
  if (recordedStep.isParam && recordedStep.paramName && paramValues[recordedStep.paramName] !== undefined) {
    action.value = paramValues[recordedStep.paramName];
  } else if (recordedStep.value) {
    action.value = recordedStep.value;
  }
  if (recordedStep.thenSubmit) action.then_submit = recordedStep.thenSubmit;
  if (recordedStep.url) action.url = recordedStep.url;
  return action;
}

// STEP 1: Try exact replay — execute the recorded action as-is
async function exactReplayStep(tabId, recordedStep, paramValues) {
  const action = buildReplayAction(recordedStep, paramValues);
  if (!action.selector) return { success: false, error: "No selector recorded" };
  action._replayMode = true;

  try {
    await ensureContentScript(tabId);
    const result = await dispatchDOMAction(tabId, action);
    if (result && result.success) {
      broadcastLog({ kind: "system", label: "Exact Replay", data: { action: action.action } });
      return { success: true };
    }
    return { success: false, error: result?.error || "Execution failed" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// STEP 1.5: Fuzzy match — score all page elements against recorded fingerprint (no LLM)
async function fuzzyMatchStep(tabId, recordedStep, paramValues) {
  const fp = recordedStep.fingerprint;
  if (!fp) return { success: false, error: "No fingerprint recorded" };

  try {
    await ensureContentScript(tabId);
    const result = await sendToTabRobust(tabId, { type: "FUZZY_FIND_ELEMENT", fingerprint: fp });

    if (!result || !result.success || !result.match) {
      return { success: false, error: result?.error || "No fuzzy match" };
    }

    broadcastLog({
      kind: "system", label: "Fuzzy Match",
      data: { score: result.match.score, selector: result.match.selector, text: result.match.text }
    });

    // Build action with the fuzzy-matched selector
    const action = buildReplayAction(recordedStep, paramValues);
    action.selector = result.match.selector;
    action._replayMode = true;

    const execResult = await dispatchDOMAction(tabId, action);
    if (execResult && execResult.success) {
      broadcastLog({ kind: "system", label: "Fuzzy Match Executed", data: { action: action.action } });
      return { success: true };
    }
    return { success: false, error: execResult?.error || "Fuzzy match execution failed" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// STEP 2: Agent fallback — build goal from fingerprint + workflow context, use existing agent brain
async function agentFallbackStep(tabId, recordedStep, paramValues, workflowContext) {
  const fp = recordedStep.fingerprint;
  let goal = "";

  // Add workflow context header
  if (workflowContext) {
    goal += `You are replaying step ${workflowContext.stepIndex + 1} of ${workflowContext.totalSteps} in workflow "${workflowContext.name}".\n`;
    if (workflowContext.completedSteps.length > 0) {
      goal += "Completed: " + workflowContext.completedSteps.map((s, i) => `${i + 1}. ${s}`).join(", ") + ".\n";
    }
    goal += "Current step: ";
  }

  // Action-specific goal with rich fingerprint details
  if (recordedStep.action === "click") {
    goal += `Click the ${fp?.tag || "element"}`;
    if (fp?.text) goal += ` with text "${fp.text}"`;
    if (fp?.ariaLabel && fp.ariaLabel !== fp?.text) goal += ` (aria-label: "${fp.ariaLabel}")`;
    if (fp?.role) goal += ` [role=${fp.role}]`;
    if (fp?.href) { try { goal += ` [href="${new URL(fp.href).pathname}"]`; } catch {} }
  } else if (recordedStep.action === "type") {
    const value = (paramValues && recordedStep.paramName && paramValues[recordedStep.paramName]) || recordedStep.value || "";
    goal += `Type "${value}" into the ${fp?.tag || "input"} field`;
    if (fp?.placeholder) goal += ` with placeholder "${fp.placeholder}"`;
    if (fp?.ariaLabel) goal += ` labeled "${fp.ariaLabel}"`;
    if (fp?.type) goal += ` [type=${fp.type}]`;
  } else if (recordedStep.action === "select") {
    goal += `Select "${recordedStep.value || ""}" from the ${fp?.tag || "select"} dropdown`;
    if (fp?.ariaLabel) goal += ` labeled "${fp.ariaLabel}"`;
  } else {
    const label = fp ? (fp.text || fp.ariaLabel || fp.placeholder || fp.tag) : "element";
    goal += `${recordedStep.action} on the ${fp?.tag || "element"} labeled "${label}"`;
  }

  // Structural context from fingerprint
  if (fp?.selectors?.cssPath) goal += `\nOriginal CSS path: ${fp.selectors.cssPath}`;
  if (fp?.parentText) goal += `\nInside container with text: "${fp.parentText.slice(0, 80)}"`;
  if (fp?.siblingTexts && fp.siblingTexts.length > 0) {
    goal += `\nNearby elements: ${fp.siblingTexts.slice(0, 3).map(t => '"' + t + '"').join(", ")}`;
  }

  // Next step preview
  if (workflowContext && workflowContext.stepIndex + 1 < workflowContext.totalSteps) {
    const nextStep = workflowContext.steps[workflowContext.stepIndex + 1];
    if (nextStep) goal += `\nNext step will be: ${nextStep.description || nextStep.action}`;
  }

  broadcastLog({ kind: "system", label: "Agent Fallback", data: { goal: goal.slice(0, 200) } });

  // Use existing agent DOM prompt → LLM → execute
  try {
    const pageState = await capturePageState(tabId);
    const prompt = buildDOMPrompt(goal, pageState, [], null, null, null);
    const result = await callLLM(prompt, agentState.model, "ReplayFallback", null, { timeout: 15000 });

    if (result && result.action && result.action !== "done" && result.action !== "error") {
      const execResult = await dispatchDOMAction(tabId, result);
      if (execResult && execResult.success) {
        broadcastLog({ kind: "system", label: "Agent Resolved", data: { action: result.action } });
        return { success: true };
      }
    }

    // DOM failed → try vision escalation (80 → 160 → raw)
    const vm = agentState.visionModel ? agentState.visionModel.trim() : "";
    if (vm) {
      for (const cap of [80, 160, 0]) {
        const esc = await _attemptVisionOnce(tabId, goal, "Replay exact+DOM failed, using vision", vm, cap);
        if (esc && esc.result && esc.result.success) {
          broadcastLog({ kind: "system", label: "Vision Resolved", data: { somCap: cap } });
          return { success: true };
        }
      }
    }
  } catch (err) {
    broadcastLog({ kind: "error", label: "Agent Fallback Failed", data: { error: err.message } });
  }

  return { success: false, error: "Agent fallback could not resolve this step" };
}

/* ───────────────────────────────────────────
 * Page State Validation
 * ─────────────────────────────────────────── */

async function validatePageState(tabId, step) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch {
    return { valid: false, reason: "Tab not found", action: "pause" };
  }

  // Domain check
  try {
    const currentDomain = new URL(tab.url || "").hostname;
    const expectedDomain = new URL(step.pageUrl || "").hostname;
    if (currentDomain !== expectedDomain) {
      broadcastLog({ kind: "system", label: "Page Mismatch", data: { expected: expectedDomain, current: currentDomain } });
      await sleep(3000);
      const tab2 = await chrome.tabs.get(tabId);
      if (new URL(tab2.url || "").hostname !== expectedDomain) {
        return { valid: false, reason: "Expected " + expectedDomain + " but on " + new URL(tab2.url || "").hostname, action: "warn" };
      }
    }
  } catch {}

  // Login wall detection
  try {
    const pageState = await capturePageState(tabId);
    const loginSignals = (pageState.elements || []).filter(el => {
      const text = ((el.text || "") + " " + (el.ariaLabel || "") + " " + (el.placeholder || "")).toLowerCase();
      return /sign.?in|log.?in|password|authenticate|login/i.test(text);
    });
    const hasPasswordInput = (pageState.elements || []).some(el => el.tag === "input" && el.type === "password");
    if (hasPasswordInput && loginSignals.length >= 2) {
      chrome.runtime.sendMessage({ type: "REPLAY_PAUSED", reason: "Login wall detected. Please log in manually, then click Resume." }).catch(() => {});
      workflowState.replayPaused = true;
      while (workflowState.replayPaused && !workflowState.replayAborted) await sleep(1000);
      if (workflowState.replayAborted) return { valid: false, reason: "Aborted", action: "abort" };
      await sleep(2000);
    }
  } catch {}

  return { valid: true };
}

/* ───────────────────────────────────────────
 * Workflow Replay Main Loop
 * ─────────────────────────────────────────── */

async function wfReplayWorkflow(workflowId, tabId, paramValues) {
  await loadConfig();
  const workflows = await loadWorkflows();
  const workflow = workflows.find(w => w.id === workflowId);
  if (!workflow) { broadcastLog({ kind: "error", label: "Workflow not found" }); return; }

  workflowState.replaying = true;
  workflowState.replayWorkflowId = workflowId;
  workflowState.replayStep = 0;
  workflowState.replayTotal = workflow.steps.length;
  workflowState.replayTabId = tabId;
  workflowState.replayAborted = false;
  workflowState.replayPaused = false;
  workflowState.replayParamValues = paramValues || {};

  // Attach debugger for trusted input events during replay
  const replayDebugger = await attachDebugger(tabId);
  if (replayDebugger) {
    broadcastLog({ kind: "system", label: "Replay Debugger Attached", data: { tabId } });
  }

  // Navigate to start URL
  await chrome.tabs.update(tabId, { url: workflow.startUrl });
  await waitForTabLoad(tabId, 15000);
  await ensureContentScript(tabId);

  broadcastLog({ kind: "system", label: "Replay Started: " + workflow.name, data: { steps: workflow.steps.length } });
  chrome.runtime.sendMessage({
    type: "REPLAY_STATUS", replaying: true, step: 0, total: workflow.steps.length, workflowName: workflow.name
  }).catch(() => {});

  for (let i = 0; i < workflow.steps.length; i++) {
    if (workflowState.replayAborted) break;
    workflowState.replayStep = i + 1;
    const step = workflow.steps[i];

    chrome.runtime.sendMessage({
      type: "REPLAY_STATUS", replaying: true, step: i + 1, total: workflow.steps.length,
      description: step.description || (step.action + " step")
    }).catch(() => {});

    // Page state validation (skip for first navigate step)
    if (i > 0 && step.pageUrl) {
      const validation = await validatePageState(tabId, step);
      if (workflowState.replayAborted) break;
      if (!validation.valid && validation.action === "abort") break;
    }

    // Navigate steps — skip if already on the target URL
    if (step.action === "navigate" && step.url) {
      // Wait for any in-progress navigation (e.g. from a prior click) to settle
      try { await waitForTabLoad(tabId, 5000); } catch {}
      const currentTab = await chrome.tabs.get(tabId);
      if (currentTab.url === step.url) {
        broadcastLog({ kind: "system", label: "Step " + (i + 1) + ": Already on page, skipping navigate" });
        continue;
      }
      broadcastLog({ kind: "system", label: "Step " + (i + 1) + ": Navigate", data: { url: step.url } });
      await chrome.tabs.update(tabId, { url: step.url });
      await waitForTabLoad(tabId, 15000);
      await ensureContentScript(tabId);
      continue;
    }

    // Scroll/wait (no element matching)
    if (step.action === "scroll" || step.action === "wait") {
      broadcastLog({ kind: "system", label: "Step " + (i + 1) + ": " + step.action });
      await ensureContentScript(tabId);
      await sendToTabRobust(tabId, { type: "EXECUTE_ACTION", action: step });
      await sleep(500);
      continue;
    }

    // Element-targeted actions: 3-step algorithm
    broadcastLog({ kind: "system", label: "Step " + (i + 1) + ": " + (step.description || step.action) });

    // Build workflow context for fallback
    const workflowContext = {
      name: workflow.name, stepIndex: i, totalSteps: workflow.steps.length,
      steps: workflow.steps,
      completedSteps: workflow.steps.slice(0, i).map(s => s.description || s.action)
    };

    // STEP 1: Exact replay (fastest — saved selector)
    let result = await exactReplayStep(tabId, step, workflowState.replayParamValues);

    // STEP 1.5: Fuzzy match (fast — local scoring, no LLM)
    if (!result.success) {
      broadcastLog({ kind: "system", label: "Exact replay failed, trying fuzzy match", data: { error: result.error } });
      result = await fuzzyMatchStep(tabId, step, workflowState.replayParamValues);
    }

    // STEP 2: Agent fallback (slow — LLM call)
    if (!result.success) {
      result = await agentFallbackStep(tabId, step, workflowState.replayParamValues, workflowContext);
    }

    if (!result.success) {
      broadcastLog({ kind: "error", label: "Step " + (i + 1) + " Failed", data: { error: result.error || "No match" } });
    }

    // Adaptive wait
    try {
      const settle = await sendToTabRobust(tabId, { type: "WAIT_FOR_SETTLE", quiet: 150, maxWait: 2000 });
      const waited = (settle && settle.elapsed) || 0;
      if (waited < 200) await sleep(200 - waited);
    } catch { await sleep(800); }
  }

  workflowState.replaying = false;
  workflowState.replayPaused = false;
  await detachDebugger();  // Remove yellow banner after replay
  const doneLabel = workflowState.replayAborted ? "Replay Stopped" : "Replay Complete";
  broadcastLog({ kind: "system", label: doneLabel + ": " + workflow.name });
  chrome.runtime.sendMessage({
    type: "REPLAY_STATUS", replaying: false, step: workflow.steps.length, total: workflow.steps.length
  }).catch(() => {});
}

console.log("[WebWright] Background service worker v2 loaded (multi-provider + chat).");
