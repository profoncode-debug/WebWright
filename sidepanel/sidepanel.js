/**
 * Side Panel Script — WebWright Extension v4
 * Two explicit modes: Chat (conversation) and Agent (browser actions).
 * Both share the same chat-style UI. Agent logs appear as chat messages.
 * Shared history queue (last 10) persists across sessions for context.
 */

(() => {
  "use strict";

  /* ── DOM ── */
  var goalInput      = document.getElementById("goalInput");
  var sendBtn        = document.getElementById("sendBtn");
  var inputActions   = document.getElementById("inputActions");
  var stopActions    = document.getElementById("stopActions");
  var stopBtn        = document.getElementById("stopBtn");
  var statusDot      = document.getElementById("statusDot");
  var statusMsg      = document.getElementById("statusMsg");
  var stepChip       = document.getElementById("stepChip");
  var modeChip       = document.getElementById("modeChip");
  var stream         = document.getElementById("stream");
  var streamInner    = document.getElementById("streamInner");
  var streamEmpty    = document.getElementById("streamEmpty");
  var clearLogsBtn   = document.getElementById("clearLogsBtn");
  var settingsBtn    = document.getElementById("settingsBtn");
  var settingsDrawer = document.getElementById("settingsDrawer");
  var cfgMaxSteps    = document.getElementById("cfgMaxSteps");
  var cfgDelay       = document.getElementById("cfgDelay");
  var cfgTimeout     = document.getElementById("cfgTimeout");
  var cfgWallTimeout = document.getElementById("cfgWallTimeout");
  var cfgSttEngine   = document.getElementById("cfgSttEngine");
  var cfgGroqKey     = document.getElementById("cfgGroqKey");
  var saveBtn        = document.getElementById("saveBtn");

  // Speech-to-text settings, shared with VoiceController. Updated on load/save.
  var sttConfig = { engine: "chrome", groqKey: "" };
  var closeCfgBtn    = document.getElementById("closeCfgBtn");
  var activityBar    = document.getElementById("activityBar");
  var chatTyping     = document.getElementById("chatTyping");
  var providerTabs   = document.getElementById("providerTabs");
  var workflowBtn    = document.getElementById("workflowBtn");
  var workflowDrawer = document.getElementById("workflowDrawer");
  var closeWorkflowBtn = document.getElementById("closeWorkflowBtn");
  var recordBtn      = document.getElementById("recordBtn");
  var workflowList   = document.getElementById("workflowList");
  var recordingBar   = document.getElementById("recordingBar");
  var stopRecordBtn  = document.getElementById("stopRecordBtn");
  var recStepCount   = document.getElementById("recStepCount");
  var replayPausedBar = document.getElementById("replayPausedBar");
  var pauseLabel     = document.getElementById("pauseLabel");
  var resumeReplayBtn = document.getElementById("resumeReplayBtn");
  var paramOverlay   = document.getElementById("paramOverlay");
  var paramTitle     = document.getElementById("paramTitle");
  var paramFields    = document.getElementById("paramFields");
  var paramRunBtn    = document.getElementById("paramRunBtn");
  var paramCancelBtn = document.getElementById("paramCancelBtn");

  var personalInfoBtn = document.getElementById("personalInfoBtn");
  var personalInfoDrawer = document.getElementById("personalInfoDrawer");
  var noApiBanner    = document.getElementById("noApiBanner");
  var noApiSettingsBtn = document.getElementById("noApiSettingsBtn");

  var chatModePill     = document.getElementById("chatModePill");
  var chatModePopover  = document.getElementById("chatModePopover");
  var chatModePillIcon = document.getElementById("chatModePillIcon");
  var chatModePillLabel = document.getElementById("chatModePillLabel");

  var voiceBtn         = document.getElementById("voiceBtn");
  var voiceOverlay     = document.getElementById("voiceOverlay");
  var voiceStateLabel  = document.getElementById("voiceStateLabel");
  var voiceTranscript  = document.getElementById("voiceTranscript");
  var voiceCloseBtn    = document.getElementById("voiceCloseBtn");

  var chatMode = (function() {
    try {
      var stored = localStorage.getItem("webwright.chatMode");
      return stored === "pro" ? "pro" : "quick";
    } catch (e) { return "quick"; }
  })();

  var isRunning = false;
  var isRecording = false;
  var currentMode = null; // "chat" | "agent" | null
  var autoScroll = true;
  var seenLogIds = {};
  var selectedProvider = "ollama_cloud";
  var loadedProviders = null;
  var agentStepCount = 0;
  var agentLogBubble = null; // The current agent log message bubble (for appending steps)
  var agentLogSteps  = null; // The steps container inside the agent log bubble

  var PROVIDERS = ["ollama_cloud", "ollama_local", "chatgpt", "claude", "gemini", "deepseek", "grok", "custom"];

  /* ── Rotating Placeholders ── */
  var placeholders = [
    "LLM timing out? Increase timeout",
    "Vision escalates automatically ",
    "Set a Vision model if not done yet.",
    "Long tasks? Use Kimi k 2.6 ",
    "Speed up tasks — lower Step Delay ",
    "More steps? Raise Max Steps in Settings",
    "Agent looping? Try a smarter model",
    "Payments & passwords need your input",
    "Ctrl+Enter to run agent mode",
    "Enter = chat  •  Ctrl+Enter = automate",
    "Claude Sonnet 4.6 best for paid",
    "Agent hallucinating? Try better models."
  ];

  /* ── Suggestion Pool (simple agent tasks) ── */
  var SUGGESTION_POOL = [
    // Open famous sites
    { text: "Open Instagram", desc: "Opens Instagram feed", icon: "nav" },
    { text: "Open YouTube", desc: "Opens YouTube homepage", icon: "nav" },
    { text: "Open Twitter", desc: "Opens Twitter/X feed", icon: "nav" },
    { text: "Open Reddit", desc: "Opens Reddit front page", icon: "nav" },
    { text: "Open LinkedIn", desc: "Opens LinkedIn feed", icon: "nav" },
    { text: "Open Facebook", desc: "Opens Facebook", icon: "nav" },
    { text: "Open WhatsApp Web", desc: "Opens WhatsApp Web", icon: "nav" },
    { text: "Open GitHub", desc: "Opens GitHub dashboard", icon: "nav" },
    { text: "Open Netflix", desc: "Opens Netflix homepage", icon: "nav" },
    { text: "Open Spotify", desc: "Opens Spotify web player", icon: "nav" },
    { text: "Open Pinterest", desc: "Opens Pinterest for inspiration", icon: "nav" },
    { text: "Open ChatGPT", desc: "Opens ChatGPT in a new tab", icon: "nav" },
    // Productivity
    { text: "Check my Gmail inbox", desc: "Opens Gmail and shows unread emails", icon: "mail" },
    { text: "Check my Outlook mail", desc: "Opens Outlook inbox", icon: "mail" },
    { text: "Open Google Calendar", desc: "Opens your Google Calendar", icon: "calendar" },
    { text: "Open Google Drive", desc: "Opens your Google Drive files", icon: "file" },
    { text: "Open Notion", desc: "Opens your Notion workspace", icon: "nav" },
    { text: "Create a new Google Doc", desc: "Opens a blank Google Doc", icon: "file" },
    // Shopping
    { text: "Open Amazon", desc: "Opens Amazon homepage", icon: "shop" },
    { text: "Open Flipkart", desc: "Opens Flipkart homepage", icon: "shop" },
    { text: "Open Myntra", desc: "Opens Myntra for shopping", icon: "shop" },
    { text: "Order food from Swiggy", desc: "Opens Swiggy ", icon: "shop" },
    { text: "Open Zomato", desc: "Opens Zomato for ", icon: "shop" },
    // Quick searches
    { text: "Search Amazon for headphones", desc: "Finds headphones on Amazon", icon: "search" },
    { text: "Search YouTube for tutorials", desc: "Searches YouTube for tutorial videos", icon: "search" },
    { text: "Search for flights to Mumbai", desc: "Finds flights on Google Flights", icon: "search" },
    { text: "Find hotels in Goa", desc: "Searches for hotel deals in Goa", icon: "search" },
    { text: "Find recipe for biryani", desc: "Searches for biryani recipe", icon: "search" },
    { text: "Search Google for latest tech news", desc: "Searches for technology news", icon: "search" },
    // Utilities
    { text: "Check today's weather", desc: "Opens weather site and reports conditions", icon: "weather" },
    { text: "Convert 100 USD to INR", desc: "Checks currency conversion rate", icon: "search" },
    { text: "Show cricket live scores", desc: "Opens live cricket scores", icon: "search" },
    { text: "Check stock market today", desc: "Opens stock market summary", icon: "search" },
  ];

  var CHIP_ICONS = {
    nav: '<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    weather: '<svg viewBox="0 0 24 24"><path d="M17.5 19H9a7 7 0 110-14h.5"/><path d="M17.5 19a4.5 4.5 0 100-9h-1.8A7 7 0 109 19h8.5z"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    shop: '<svg viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  };

  function renderRandomChips() {
    var container = document.getElementById("suggestionsContainer");
    if (!container) return;
    var shuffled = SUGGESTION_POOL.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }
    var picked = shuffled.slice(0, 3);
    container.innerHTML = "";
    picked.forEach(function(item, idx) {
      var btn = document.createElement("button");
      btn.className = "suggestion-chip";
      btn.setAttribute("data-text", item.text);
      if (item.mode) btn.setAttribute("data-mode", item.mode);
      btn.style.animationDelay = (2.0 + idx * 0.15) + "s";
      btn.innerHTML =
        '<div class="chip-icon">' + (CHIP_ICONS[item.icon] || CHIP_ICONS.search) + '</div>' +
        '<div class="chip-text">' +
          '<div class="chip-label">' + item.text + '</div>' +
          '<div class="chip-desc">' + item.desc + '</div>' +
        '</div>';
      btn.addEventListener("click", function() {
        var text = btn.getAttribute("data-text");
        var mode = btn.getAttribute("data-mode");
        if (text && !isRunning) {
          if (mode === "chat" || text.toLowerCase().indexOf("summarize") >= 0) {
            chatSend(text);
          } else {
            // Run the task on the current tab — no tab-choice prompt.
            agentSend(text, true);
          }
        }
      });
      container.appendChild(btn);
    });
  }
  function updateEmptyState(providers) {
    var chips = document.getElementById("suggestionsContainer");
    if (!noApiBanner || !chips) return;
    var key = providers && providers.ollama_cloud && providers.ollama_cloud.apiKey;
    if (!key || !key.trim()) {
      noApiBanner.classList.remove("hidden");
      chips.classList.add("hidden");
    } else {
      noApiBanner.classList.add("hidden");
      chips.classList.remove("hidden");
    }
  }

  var placeholderIdx = 0;
  var placeholderTimer = null;

  function startPlaceholderRotation() {
    if (placeholderTimer) return;
    placeholderTimer = setInterval(function() {
      if (document.activeElement === goalInput) return;
      placeholderIdx = (placeholderIdx + 1) % placeholders.length;
      goalInput.style.transition = "opacity 0.2s";
      goalInput.style.opacity = "0.5";
      setTimeout(function() {
        goalInput.placeholder = placeholders[placeholderIdx];
        goalInput.style.opacity = "1";
      }, 200);
    }, 4000);
  }

  function stopPlaceholderRotation() {
    if (placeholderTimer) { clearInterval(placeholderTimer); placeholderTimer = null; }
  }

  /* ═══════════════════════════════════════════
   * Markdown + Math rendering (marked.js + KaTeX, bundled in ../lib/)
   *
   * renderMarkdown(text)     → HTML string from full-spec markdown (tables,
   *                            nested lists, strikethrough, code blocks, etc.)
   * renderMathInBubble(el)   → typeset any LaTeX delimited by $…$, $$…$$,
   *                            \(…\) or \[…\] inside the bubble after innerHTML
   *                            has been set.
   *
   * If marked or KaTeX failed to load (e.g. file missing), we fall back to a
   * minimal escape-and-paragraph wrap so the chat stays readable.
   * ═══════════════════════════════════════════ */

  // Configure marked once: GFM (tables, strikethrough, autolinks), preserve line breaks.
  (function configureMarked() {
    if (typeof marked === "undefined" || !marked.setOptions) return;
    try {
      marked.setOptions({
        gfm: true,
        breaks: true,
        headerIds: false,
        mangle: false
      });
    } catch (_) {}
  })();

  function renderMarkdown(text) {
    if (!text) return "";
    if (typeof marked !== "undefined" && marked.parse) {
      try { return marked.parse(text); } catch (_) { /* fall through */ }
    }
    // Fallback: escape + paragraph wrap
    var esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return "<p>" + esc.replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
  }

  function renderMathInBubble(el) {
    if (!el || typeof renderMathInElement === "undefined") return;
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$",  right: "$",  display: false },
          { left: "\\(", right: "\\)", display: false }
        ],
        throwOnError: false,
        errorColor: "#cc6666",
        // Skip math inside <code>, <pre>, <script>, <noscript> so code samples
        // and shell prompts that contain stray dollars don't get hijacked.
        ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"]
      });
    } catch (_) { /* ignore: leave raw LaTeX visible rather than crash */ }
  }

  /* ═══════════════════════════════════════════
   * Messaging
   * ═══════════════════════════════════════════ */

  function sendMsg(msg) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage(msg, function(res) {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(res);
      });
    });
  }

  /* ═══════════════════════════════════════════
   * Stream Helpers
   * ═══════════════════════════════════════════ */

  function hideEmpty() {
    if (streamEmpty) streamEmpty.style.display = "none";
  }

  function addChatMessage(type, content) {
    hideEmpty();
    var msg = document.createElement("div");
    msg.className = "chat-msg " + type;

    var bubble = document.createElement("div");
    bubble.className = "chat-bubble";

    if (type === "assistant") {
      bubble.innerHTML = renderMarkdown(content);
      renderMathInBubble(bubble);
    } else {
      bubble.textContent = content;
    }

    msg.appendChild(bubble);
    streamInner.insertBefore(msg, chatTyping);
    scrollToBottom();
  }

  function scrollToBottom() {
    if (autoScroll) {
      requestAnimationFrame(function() {
        stream.scrollTop = stream.scrollHeight;
      });
    }
  }

  /* ═══════════════════════════════════════════
   * Agent Log Messages (rendered inline in chat)
   * ═══════════════════════════════════════════ */

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function truncate(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "..." : s;
  }

  /** Strip technical selectors from text */
  function cleanTechnical(text) {
    if (!text) return "";
    return text.replace(/\[data-agent-id="[^"]*"\]/g, "target element").replace(/\s{2,}/g, " ").trim();
  }

  /** Create the agent log bubble (one per agent run, steps appended live) */
  function createAgentLogBubble(goal) {
    hideEmpty();
    var msg = document.createElement("div");
    msg.className = "chat-msg agent-log";

    var bubble = document.createElement("div");
    bubble.className = "chat-bubble";

    bubble.innerHTML =
      '<div class="agent-log-header">' +
        '<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' +
        'Agent Working' +
      '</div>' +
      '<div class="agent-log-steps" id="agentStepsContainer"></div>';

    msg.appendChild(bubble);
    streamInner.insertBefore(msg, chatTyping);

    agentLogBubble = msg;
    agentLogSteps = bubble.querySelector(".agent-log-steps");
    agentStepCount = 0;
    lastShownLabel = "";
    pendingThinking = null;
    pendingRawContent = null;
    pendingParsedAction = null;
    pendingOllamaResponse = null;
    scrollToBottom();
  }

  /* ── Workflow replay log (same chat-like bubble as the agent log) ── */
  var replayLogBubble = null;
  var replayLogSteps = null;

  function createReplayLog(name) {
    hideEmpty();
    var msg = document.createElement("div");
    msg.className = "chat-msg agent-log";
    var bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.innerHTML =
      '<div class="agent-log-header">' +
        '<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
        'Replaying ' + esc(name || "workflow") +
      '</div>' +
      '<div class="agent-log-steps"></div>';
    msg.appendChild(bubble);
    streamInner.insertBefore(msg, chatTyping);
    replayLogBubble = msg;
    replayLogSteps = bubble.querySelector(".agent-log-steps");
    scrollToBottom();
  }

  function addReplayStep(text, dotCls) {
    if (!replayLogSteps) createReplayLog("");
    var step = document.createElement("div");
    step.className = "agent-step-item";
    step.innerHTML =
      '<div class="agent-step-dot ' + (dotCls || "done") + '"></div>' +
      '<div class="agent-step-text">' + esc(text) + '</div>';
    replayLogSteps.appendChild(step);
    scrollToBottom();
  }

  function finishReplayLog(text, ok) {
    if (replayLogBubble) {
      var header = replayLogBubble.querySelector(".agent-log-header");
      if (header) {
        header.innerHTML =
          '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>' + esc(text || "Replay complete");
        header.style.color = ok === false ? "var(--text-muted)" : "var(--text-secondary)";
      }
    }
    replayLogBubble = null;
    replayLogSteps = null;
  }

  var lastShownLabel = "";
  var isReplaying = false;

  /* ── LLM response buffer (attached to next visible step) ── */
  var pendingThinking = null;
  var pendingRawContent = null;
  var pendingParsedAction = null;
  var pendingOllamaResponse = null;

  /** Human-friendly action description */
  function describeAction(data) {
    if (!data || !data.action) return "Processing...";
    // Vision mode indicator: show whether LLM used element number or raw coords
    var visionTag = "";
    if (data._somSelector) {
      visionTag = " [vision: element #" + data.element + "]";
    } else if (data.element != null && !data._somSelector) {
      visionTag = " [vision: element #" + data.element + "]";
    } else if (data.x != null && data.y != null && !data.selector) {
      visionTag = " [vision: coords (" + data.x + "," + data.y + ")]";
    }
    switch (data.action) {
      case "click":
        var t = data.description || "";
        return (t ? "Clicking the " + truncate(t, 50) : "Clicking an element") + visionTag;
      case "type":
        if (data.then_submit) return 'Searching for "' + truncate(data.value || "", 40) + '"' + visionTag;
        var into = data.description || "a field";
        return 'Typing "' + truncate(data.value || "", 40) + '" in ' + truncate(into, 30) + visionTag;
      case "navigate":
        var url = data.url || "";
        var domain = url;
        try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch(e) {}
        return "Opening " + truncate(domain, 40);
      case "scroll":
        return "Scrolling " + (data.direction || "down") + " to see more";
      case "wait":
        return "Waiting for page to load";
      case "select":
        return 'Choosing "' + truncate(data.value || "", 40) + '"';
      case "key":
        return "Pressing " + (data.key || "key");
      case "hover":
        return "Hovering over " + truncate(data.description || "element", 40) + visionTag;
      case "done":
        return data.summary || "Task complete!";
      case "error":
        return "Couldn't proceed" + (data.reason ? " — " + data.reason : "");
      default:
        return data.action;
    }
  }

  /** Get friendly text for a log entry */
  function friendlyLabel(kind, data, label) {
    if (kind === "execution") {
      var act = data.action || {};
      var res = data.result || {};
      if (res.success) return describeAction(act);
      return "Retrying with a different approach...";
    }
    if (kind === "system") {
      if (label && label.indexOf("Achieved") >= 0) return null; // handled separately as done summary
      if (label && (label.indexOf("Escalat") >= 0 || label.indexOf("Switching to Vision") >= 0)) return "Using vision 👁️";
      if (label && label.indexOf("Progress") >= 0) return null; // handled separately
      if (label && label.indexOf("Aborted") >= 0) return "Task stopped";
      return null;
    }
    if (kind === "error" || kind === "ollama_error") {
      return "Something went wrong — retrying...";
    }
    return null;
  }

  /** Decide if a log entry should appear as a step */
  function isVisibleLog(kind, data, label) {
    if (kind === "parsed_action") return false;
    if (kind === "page_state") return false;
    if (kind === "execution") {
      var act = data.action || {};
      if (act.action === "done" || act.action === "error") return false;
      return true;
    }
    if (kind === "error" || kind === "ollama_error") return true;
    if (kind === "system") {
      if (!label) return false;
      if (label.indexOf("Achieved") >= 0) return true; // for done summary
      if (label.indexOf("Escalat") >= 0) return true;
      if (label.indexOf("Progress") >= 0) return true; // for progress summary
      if (label.indexOf("Aborted") >= 0) return true;
      return false;
    }
    return false;
  }

  /** Get dot color class for a step */
  function stepDotClass(kind, data) {
    if (kind === "execution") {
      var res = data.result || {};
      return res.success ? "acting" : "error";
    }
    if (kind === "error" || kind === "ollama_error") return "error";
    if (kind === "system") {
      var label = data._label || "";
      if (label.indexOf("Achieved") >= 0) return "success";
      if (label.indexOf("Escalat") >= 0) return "info";
      if (label.indexOf("Progress") >= 0) return "info";
      return "info";
    }
    return "info";
  }

  /** Add a step to the current agent log bubble */
  function addAgentStep(log) {
    if (!agentLogSteps) return;

    var kind = log.kind || "system";
    var data = log.data || {};
    var label = log.label || "";

    // Buffer LLM data for attachment to next visible step
    if (kind === "thinking") {
      pendingThinking = data.thinkingText || null;
    }
    if (kind === "llm_raw") {
      pendingRawContent = data.rawContent || null;
    }
    if (kind === "parsed_action") {
      pendingParsedAction = data || null;
    }
    if (kind === "ollama_response") {
      pendingOllamaResponse = data || null;
    }

    if (!isVisibleLog(kind, data, label)) {
      // Manage thinking indicator
      if (kind === "ollama_request") showThinkingIndicator();
      if (kind === "ollama_response" || kind === "parsed_action") hideThinkingIndicator();
      return;
    }

    hideThinkingIndicator();

    // Handle done summary — special rendering
    if (kind === "system" && label && label.indexOf("Achieved") >= 0) {
      var summary = data.summary || "Task complete!";
      finishAgentLog("done", summary);
      VoiceController.narrateDone(summary); // speak the conclusion (voice mode only)
      return;
    }

    // Handle progress report
    if (kind === "system" && label && label.indexOf("Progress") >= 0) {
      var progSummary = data.summary || data.reason || "Partial progress made.";
      finishAgentLog("progress", progSummary);
      VoiceController.narrateDone(progSummary);
      return;
    }

    // Normal step
    data._label = label; // pass label for dot color detection
    var text = friendlyLabel(kind, data, label);
    if (text && text.length > 50) text = text.slice(0, 47) + "…";
    if (!text) return;

    // Deduplicate
    if (text === lastShownLabel) return;
    lastShownLabel = text;

    // Voice narration of live steps (throttled / drop-stale inside VoiceController)
    VoiceController.narrate(text);

    var step = document.createElement("div");
    step.className = "agent-step-item";

    // Capture buffered LLM data for this step
    var stepLLMData = null;
    if (pendingThinking || pendingRawContent || pendingParsedAction || pendingOllamaResponse) {
      stepLLMData = {
        thinking: pendingThinking,
        rawContent: pendingRawContent,
        parsedAction: pendingParsedAction,
        response: pendingOllamaResponse
      };
      pendingThinking = null;
      pendingRawContent = null;
      pendingParsedAction = null;
      pendingOllamaResponse = null;
    }

    // For error logs, extract real error info for the detail panel
    var errorDetail = null;
    if (kind === "error" || kind === "ollama_error") {
      var errMsg = label || "";
      if (data.error) errMsg += (errMsg ? ": " : "") + data.error;
      else if (data.message) errMsg += (errMsg ? ": " : "") + data.message;
      else if (data.raw) errMsg += (errMsg ? ": " : "") + (typeof data.raw === "string" ? data.raw.slice(0, 200) : JSON.stringify(data.raw).slice(0, 200));
      if (!errMsg) errMsg = JSON.stringify(data).slice(0, 300);
      errorDetail = errMsg;
    }

    var hasDetail = !!stepLLMData || !!errorDetail;
    var dotCls = stepDotClass(kind, data);
    step.innerHTML =
      '<div class="agent-step-dot ' + dotCls + '"></div>' +
      '<div class="agent-step-text"></div>' +
      (hasDetail ? '<div class="agent-step-expand">&#9654;</div>' : '');

    if (hasDetail) {
      step.classList.add("has-detail");
      // Build detail panel
      var detailEl = document.createElement("div");
      detailEl.className = "agent-step-detail";
      var detailHtml = "";

      if (stepLLMData && stepLLMData.thinking) {
        detailHtml += '<div class="detail-section">' +
          '<div class="detail-label">Thinking</div>' +
          '<pre class="detail-content">' + esc(stepLLMData.thinking) + '</pre>' +
          '</div>';
      }

      if (stepLLMData && stepLLMData.rawContent) {
        detailHtml += '<div class="detail-section">' +
          '<div class="detail-label">Raw Output</div>' +
          '<pre class="detail-content">' + esc(stepLLMData.rawContent) + '</pre>' +
          '</div>';
      }

      if (stepLLMData && stepLLMData.parsedAction) {
        detailHtml += '<div class="detail-section">' +
          '<div class="detail-label">Parsed Action</div>' +
          '<pre class="detail-content">' + esc(JSON.stringify(stepLLMData.parsedAction, null, 2)) + '</pre>' +
          '</div>';
      }

      if (stepLLMData && stepLLMData.response) {
        var respSummary = {};
        if (stepLLMData.response.model) respSummary.model = stepLLMData.response.model;
        if (stepLLMData.response.provider) respSummary.provider = stepLLMData.response.provider;
        if (stepLLMData.response.elapsed_ms) respSummary.elapsed_ms = stepLLMData.response.elapsed_ms;
        detailHtml += '<div class="detail-section">' +
          '<div class="detail-label">Model Info</div>' +
          '<pre class="detail-content">' + esc(JSON.stringify(respSummary, null, 2)) + '</pre>' +
          '</div>';
      }

      if (errorDetail) {
        detailHtml += '<div class="detail-section">' +
          '<div class="detail-label">Error Details</div>' +
          '<pre class="detail-content" style="color:var(--red)">' + esc(errorDetail) + '</pre>' +
          '</div>';
      }

      detailEl.innerHTML = detailHtml;
      step.appendChild(detailEl);

      // Click to toggle
      step.addEventListener("click", function() {
        step.classList.toggle("expanded");
        scrollToBottom();
      });
    }

    agentLogSteps.appendChild(step);

    // Typewriter effect
    var textEl = step.querySelector(".agent-step-text");
    var escaped = esc(text);
    if (!isReplaying && escaped.length > 0) {
      textEl.textContent = "";
      textEl.classList.add("typewriter");
      var charIdx = 0;
      var typeInterval = setInterval(function() {
        if (charIdx < escaped.length) {
          textEl.textContent += escaped[charIdx];
          charIdx++;
          scrollToBottom();
        } else {
          clearInterval(typeInterval);
          textEl.classList.remove("typewriter");
        }
      }, 18);
    } else {
      textEl.textContent = text;
    }

    scrollToBottom();
  }

  /** Finish the agent log bubble with a done summary or progress report */
  function finishAgentLog(type, summary) {
    if (!agentLogSteps) return;

    // Update header
    if (agentLogBubble) {
      var header = agentLogBubble.querySelector(".agent-log-header");
      if (header) {
        if (type === "done") {
          header.innerHTML =
            '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>' +
            'Agent Completed';
          header.style.color = "var(--text-secondary)";
        } else {
          header.innerHTML =
            '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' +
            'Agent Stopped';
          header.style.color = "var(--text-muted)";
        }
      }
    }

    // Render final thinking if buffered (from last LLM call before done)
    if (pendingThinking) {
      var thinkStep = document.createElement("div");
      thinkStep.className = "agent-step-item has-detail";
      thinkStep.innerHTML =
        '<div class="agent-step-dot acting"></div>' +
        '<div class="agent-step-text">Final reasoning</div>' +
        '<div class="agent-step-expand">&#9654;</div>';
      var thinkDetail = document.createElement("div");
      thinkDetail.className = "agent-step-detail";
      thinkDetail.innerHTML = '<div class="detail-section">' +
        '<div class="detail-label">Thinking</div>' +
        '<pre class="detail-content">' + esc(pendingThinking) + '</pre>' +
        '</div>';
      thinkStep.appendChild(thinkDetail);
      thinkStep.addEventListener("click", function() {
        thinkStep.classList.toggle("expanded");
      });
      agentLogSteps.appendChild(thinkStep);
      pendingThinking = null;
    }

    // Normalize summary text
    if (typeof summary !== "string") summary = Array.isArray(summary) ? summary.join("\n") : String(summary || "Task complete!");
    summary = summary.trim() || "Task complete!";

    // Render the outcome as a normal assistant chat bubble — whether the agent
    // finished or stopped early. On failure the summary reads as a short recap of
    // what it did and why it couldn't finish (no green bullet list, no extra cards).
    addChatMessage("assistant", summary);

    scrollToBottom();

    // Detach refs so subsequent chat LLM calls don't leak "Thinking..." into the finished bubble
    hideThinkingIndicator();
    agentLogBubble = null;
    agentLogSteps = null;
  }

  /* ── Thinking indicator inside agent log ── */
  var thinkingEl = null;

  function showThinkingIndicator() {
    if (thinkingEl) return;
    if (!agentLogSteps) return;

    thinkingEl = document.createElement("div");
    thinkingEl.className = "agent-step-item";
    thinkingEl.innerHTML =
      '<div class="agent-step-dot thinking"></div>' +
      '<div class="agent-step-text" style="color:var(--text-muted)">Thinking...</div>';
    agentLogSteps.appendChild(thinkingEl);
    scrollToBottom();
  }

  function hideThinkingIndicator() {
    if (thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  /* ═══════════════════════════════════════════
   * Chat Send
   * ═══════════════════════════════════════════ */

  async function chatSend(text, alreadyEchoed) {
    if (!text) return;

    var isPro = chatMode === "pro";
    if (!alreadyEchoed) {
      addChatMessage("user", text);
      goalInput.value = "";
      goalInput.style.height = "";
    }

    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    var tabId = (tab && tab.id) ? tab.id : null;

    if (isPro) setStatus("thinking", "Capturing screen...");
    else       setStatus("thinking", "Thinking...");
    chatTyping.classList.add("visible");

    var result = await sendMsg({ type: "CHAT_SEND", text: text, tabId: tabId, mode: chatMode });

    if (isPro) setStatus("thinking", "Thinking...");

    chatTyping.classList.remove("visible");

    if (!result || !result.success) {
      addChatMessage("system-info", "Error: " + ((result && result.error) || "Failed to process."));
      setStatus("error", "Chat error");
      return null;
    }

    currentMode = "chat";
    modeChip.textContent = "CHAT";
    modeChip.className = "mode-chip chat";
    modeChip.classList.remove("hidden");
    stepChip.classList.add("hidden");

    addChatMessage("assistant", result.content);
    setStatus("idle", "Chat ready");

    // Auto-hand off to the agent (current tab) when the chat model signals it.
    // Matches the exact phrase the chat system prompt is told to emit.
    if (result.content && /switching to agent mode/i.test(result.content)) {
      setTimeout(function() { agentSend(text, true); }, 400);
    }

    // Return the assistant reply so Voice Mode can speak it (typed chats ignore this).
    return result.content || null;
  }

  /* ═══════════════════════════════════════════
   * Agent Send
   * ═══════════════════════════════════════════ */

  async function agentSend(text, useCurrentTab, alreadyEchoed) {
    if (!text || isRunning) return;

    if (!alreadyEchoed) {
      addChatMessage("user", text);
      goalInput.value = "";
      goalInput.style.height = "";
    }

    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    var tabId = (tab && tab.id) ? tab.id : null;

    setStatus("thinking", "Starting agent...");

    var result = await sendMsg({ type: "AGENT_SEND", text: text, tabId: tabId, useCurrentTab: !!useCurrentTab });

    if (!result || !result.success) {
      addChatMessage("system-info", "Error: " + ((result && result.error) || "Failed to start agent."));
      setStatus("error", "Agent error");
      return;
    }

    currentMode = "agent";
    isRunning = true;
    updateButtons();
    modeChip.textContent = "AGENT";
    modeChip.className = "mode-chip agent";
    modeChip.classList.remove("hidden");
    stepChip.classList.remove("hidden");

    // Create the agent log bubble in chat
    createAgentLogBubble(text);
    setStatus("active", "Agent running...");
  }

  /* ═══════════════════════════════════════════
   * Smart routing — one input, auto-decides Chat vs Agent and which tab.
   * Used by the single Send button, the Enter key, and Voice Mode.
   *   opts.forceAgent : skip intent classification, always run as agent
   *                     (Ctrl+Enter). Tab is still decided by the classifier.
   * Returns { intent, reply } so Voice Mode can speak the chat reply.
   * ═══════════════════════════════════════════ */
  async function routeMessage(text, opts) {
    opts = opts || {};
    if (!text || isRunning) return null;

    // Echo the user's message immediately so the UI feels responsive while the
    // classifier (which may make an LLM call) runs.
    addChatMessage("user", text);
    goalInput.value = "";
    goalInput.style.height = "";
    setStatus("thinking", "Thinking...");

    // Grab current tab so the classifier can decide current-vs-new tab.
    var tabUrl = "", tabTitle = "";
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) { tabUrl = tabs[0].url || ""; tabTitle = tabs[0].title || ""; }
    } catch (e) {}

    var res = null;
    try {
      res = await sendMsg({ type: "CLASSIFY_MESSAGE", text: text, tabUrl: tabUrl, tabTitle: tabTitle });
    } catch (e) {}

    var intent = opts.forceAgent ? "agent" : ((res && res.intent) || "chat");

    if (intent === "agent") {
      // Always run on the current tab — never open a new one.
      agentSend(text, true, true);
      return { intent: "agent" };
    }
    var reply = await chatSend(text, true);
    return { intent: "chat", reply: reply };
  }

  /* ═══════════════════════════════════════════
   * Voice Mode — hands-free input (Web Speech STT) + output (TTS)
   *
   * STT: webkitSpeechRecognition (continuous). NOTE: Chrome streams mic audio
   *      to Google's servers — disclosed in the overlay + privacy policy.
   * TTS: speechSynthesis (fully on-device).
   *
   * Flow: listen → pause ~1.2s → classify (chat vs agent) → route to
   *       chatSend/agentSend → speak the reply / agent done-summary.
   * Echo guard: recognition results are dropped while TTS is speaking.
   * ═══════════════════════════════════════════ */
  var VoiceController = (function() {
    var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    var SILENCE_MS = 1200;

    var enabled = false;
    var usingGroq = false;        // true → Groq Whisper STT path (Brave / user choice)
    var recognition = null;
    var state = "idle";           // idle | listening | speaking  (2 visible states)
    var silenceTimer = null;
    var finalTranscript = "";
    var lastInterim = "";          // latest interim text (continuous mode often never finalizes)
    var lastInputWasVoice = false; // gates agent narration TTS
    var restartGuard = false;      // prevents onend restart while we intentionally stop
    var pendingNarration = null;   // drop-stale narration slot
    var lastVoiceGoal = "";        // the goal of the current voice-initiated agent task
    var agentWorking = false;      // true while a voice-dispatched agent task runs (mic OFF)
    // Diagnostics / loop-breaker for failed recognition cycles
    var cycleStart = 0;
    var gotResultThisCycle = false;
    var emptyEndStreak = 0;
    var lastError = "";

    function supported() { return !!SpeechRec && !!window.speechSynthesis; }
    // Groq path needs only mic recording + TTS for replies (no Web Speech STT).
    function groqSupported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
                window.MediaRecorder && window.speechSynthesis);
    }

    /* ── Groq Whisper STT (alternative to Chrome's Web Speech) ──
     * Records the mic continuously and slices utterances with a small volume
     * VAD: when speech is followed by ~SILENCE_MS of quiet, the clip is sent to
     * Groq's transcription endpoint and the text is routed exactly like the
     * Chrome path (dispatchTranscript → thinking → speak → listen). The mic is
     * ignored while Thinking/Speaking — the VAD only acts in the listening state. */
    var GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
    var GROQ_STT_MODEL = "whisper-large-v3-turbo";
    var VAD_THRESHOLD = 0.018;    // RMS of normalized PCM that counts as speech
    var groq = {
      stream: null, ctx: null, analyser: null, source: null, buf: null,
      recorder: null, recMime: "audio/webm", chunks: [], recArmTime: 0,
      tickTimer: null, hasSpeech: false, silenceStart: 0, pendingTranscribe: false
    };

    function pickRecMime() {
      try {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
        if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
        if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) return "audio/ogg;codecs=opus";
      } catch (e) {}
      return "";
    }

    function groqOnStop() {
      var blob = new Blob(groq.chunks, { type: groq.recMime || "audio/webm" });
      groq.chunks = [];
      var wanted = groq.pendingTranscribe;
      groq.pendingTranscribe = false;
      if (wanted && blob.size > 1500) {
        groqTranscribe(blob);   // → dispatchTranscript on success (thinking → speak → listen)
      } else if (enabled && usingGroq && groq.stream && state === "listening") {
        groqArm();              // idle re-arm: keep listening with a fresh recorder
      }
    }

    function groqArm() {
      if (!groq.stream) return;
      groq.chunks = [];
      try {
        var mime = pickRecMime();
        groq.recorder = mime ? new MediaRecorder(groq.stream, { mimeType: mime })
                             : new MediaRecorder(groq.stream);
      } catch (e) {
        try { groq.recorder = new MediaRecorder(groq.stream); } catch (e2) { return; }
      }
      groq.recMime = (groq.recorder && groq.recorder.mimeType) || "audio/webm";
      groq.recArmTime = Date.now();
      groq.recorder.ondataavailable = function (e) { if (e.data && e.data.size) groq.chunks.push(e.data); };
      groq.recorder.onstop = groqOnStop;
      try { groq.recorder.start(); } catch (e) {}
    }

    function groqCut(doTranscribe) {
      groq.pendingTranscribe = !!doTranscribe;
      if (groq.recorder && groq.recorder.state === "recording") {
        try { groq.recorder.stop(); } catch (e) { groq.pendingTranscribe = false; }
      }
    }

    function groqVADTick() {
      groq.tickTimer = null;
      if (!enabled || !usingGroq || !groq.analyser) return;
      try {
        groq.analyser.getByteTimeDomainData(groq.buf);
        var sum = 0;
        for (var i = 0; i < groq.buf.length; i++) { var v = (groq.buf[i] - 128) / 128; sum += v * v; }
        var rms = Math.sqrt(sum / groq.buf.length);
        var now = Date.now();

        // Only react while truly listening — mic is ignored during Thinking/Speaking.
        if (state === "listening") {
          if (rms > VAD_THRESHOLD) {
            groq.hasSpeech = true;
            groq.silenceStart = 0;
          } else if (groq.hasSpeech) {
            if (!groq.silenceStart) groq.silenceStart = now;
            else if (now - groq.silenceStart >= SILENCE_MS) {
              groq.hasSpeech = false; groq.silenceStart = 0;
              groqCut(true);   // utterance complete → transcribe
            }
          } else if (groq.recorder && groq.recorder.state === "recording" && (now - groq.recArmTime) > 12000) {
            groqCut(false);    // long idle silence → drop & re-arm to bound memory
          }
        }
      } catch (e) {}
      groq.tickTimer = setTimeout(groqVADTick, 100);
    }

    async function groqStart() {
      try {
        groq.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        addChatMessage("system-info", "Voice mode couldn't access the microphone (\"" + (e && e.name || "error") + "\"). Grant mic permission for this extension, then turn voice mode on again.");
        micPermissionHelp();
        disable();
        return;
      }
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        groq.ctx = new AC();
        groq.source = groq.ctx.createMediaStreamSource(groq.stream);
        groq.analyser = groq.ctx.createAnalyser();
        groq.analyser.fftSize = 512;
        groq.source.connect(groq.analyser);
        groq.buf = new Uint8Array(groq.analyser.fftSize);
      } catch (e) {
        addChatMessage("system-info", "Voice mode couldn't start audio analysis. Try reloading the extension.");
        disable();
        return;
      }
      groq.hasSpeech = false; groq.silenceStart = 0;
      groqArm();
      groqVADTick();
    }

    function groqResume() {
      if (!groq.stream) { groqStart(); return; }
      groq.hasSpeech = false; groq.silenceStart = 0;
      groqArm();
      if (!groq.tickTimer) groqVADTick();
    }

    // Pause Groq listening without releasing the mic — used while the agent
    // works. groqResume() re-arms quickly without re-prompting for permission.
    function groqPause() {
      if (groq.tickTimer) { clearTimeout(groq.tickTimer); groq.tickTimer = null; }
      try {
        if (groq.recorder && groq.recorder.state === "recording") {
          groq.pendingTranscribe = false;
          groq.recorder.stop();
        }
      } catch (e) {}
      groq.hasSpeech = false; groq.silenceStart = 0;
    }

    function groqStop() {
      if (groq.tickTimer) { clearTimeout(groq.tickTimer); groq.tickTimer = null; }
      try { if (groq.recorder && groq.recorder.state !== "inactive") { groq.pendingTranscribe = false; groq.recorder.stop(); } } catch (e) {}
      try { if (groq.stream) groq.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { if (groq.ctx) groq.ctx.close(); } catch (e) {}
      groq.stream = null; groq.ctx = null; groq.analyser = null; groq.source = null;
      groq.buf = null; groq.recorder = null; groq.chunks = [];
      groq.hasSpeech = false; groq.silenceStart = 0; groq.pendingTranscribe = false;
    }

    async function groqTranscribe(blob) {
      setState("thinking");   // mic ignored from here until we finish speaking
      setTranscript("");
      var key = sttConfig.groqKey;
      if (!key) {
        addChatMessage("system-info", "Voice mode: add your Groq API key in Settings → Speech-to-Text to use Groq transcription.");
        disable();
        return;
      }
      try {
        var fd = new FormData();
        fd.append("file", blob, "audio.webm");
        fd.append("model", GROQ_STT_MODEL);
        fd.append("response_format", "text");
        fd.append("temperature", "0");
        var resp = await fetch(GROQ_STT_URL, {
          method: "POST",
          headers: { "Authorization": "Bearer " + key },
          body: fd
        });
        if (!resp.ok) {
          var errTxt = "";
          try { errTxt = await resp.text(); } catch (e) {}
          console.warn("[Voice] Groq STT error", resp.status, errTxt);
          if (resp.status === 401 || resp.status === 403) {
            addChatMessage("system-info", "Voice mode: the Groq API key was rejected (" + resp.status + "). Check it in Settings → Speech-to-Text.");
            disable();
            return;
          }
          speak("Sorry, I couldn't catch that, try again?");
          return;
        }
        var text = ((await resp.text()) || "").trim();
        if (!text) { resumeListening(); return; }   // no words → keep listening
        dispatchTranscript(text);
      } catch (e) {
        console.warn("[Voice] Groq STT failed", e);
        speak("I had trouble hearing you, mind repeating that?");
      }
    }

    // Three states: Listening (mic live) | Thinking (busy) | Speaking (TTS).
    // The mic is IGNORED while Thinking or Speaking; it only listens otherwise.
    function setState(s) {
      state = s;
      if (!voiceOverlay) return;
      voiceOverlay.setAttribute("data-state", s);
      if (voiceStateLabel) {
        voiceStateLabel.textContent =
          s === "speaking" ? "Speaking…" :
          s === "thinking" ? "Thinking…" :
          s === "working"  ? "Working…" : "Listening…";
      }
    }

    function showOverlay(show) {
      if (!voiceOverlay) return;
      voiceOverlay.classList.toggle("hidden", !show);
    }

    function setTranscript(t) {
      if (voiceTranscript) voiceTranscript.textContent = t || "";
    }

    function buildRecognition() {
      var rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";

      rec.onstart = function() {
        cycleStart = Date.now();
        gotResultThisCycle = false;
        console.log("[Voice] recognition started");
      };
      rec.onaudiostart  = function(){ console.log("[Voice] audio capture started (mic OK)"); };
      rec.onspeechstart = function(){ console.log("[Voice] speech detected"); };

      rec.onresult = function(event) {
        gotResultThisCycle = true;
        emptyEndStreak = 0;
        // Ignore the mic entirely while Thinking or Speaking — only listen when
        // we're actually in the listening state.
        if (state === "speaking" || state === "thinking") {
          // Don't let a stale silence timer fire mid-think/speak.
          if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
          return;
        }
        if (state !== "listening") setState("listening");

        var interim = "";
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var res = event.results[i];
          if (res.isFinal) finalTranscript += res[0].transcript + " ";
          else interim += res[0].transcript;
        }
        lastInterim = interim; // remember it — in continuous mode a "final" may never arrive
        setTranscript((finalTranscript + interim).trim());

        // Restart the silence countdown on every result.
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(onSilence, SILENCE_MS);
      };

      rec.onerror = function(event) {
        lastError = event.error || "unknown";
        console.warn("[Voice] recognition error:", lastError, event.message || "");
        if (lastError === "not-allowed" || lastError === "service-not-allowed") {
          addChatMessage("system-info", "Voice mode couldn't access the microphone (\"" + lastError + "\"). Grant mic permission for this extension, then turn voice mode on again. See the note below if no prompt appears.");
          micPermissionHelp();
          disable();
          return;
        }
        // "no-speech" / "network" / "aborted" — handled by the onend loop-breaker.
      };

      rec.onend = function() {
        if (!enabled || restartGuard || state === "speaking") return;

        var elapsed = Date.now() - cycleStart;
        // A healthy cycle that captured speech, or a long idle listen, is normal — restart quietly.
        if (gotResultThisCycle || elapsed > 1500) {
          emptyEndStreak = 0;
          try { rec.start(); } catch (e) {}
          return;
        }

        // Cycle ended almost immediately with no audio/result — recognition is
        // failing (usually mic permission or a network block). Break the loop
        // instead of restarting forever.
        emptyEndStreak++;
        console.warn("[Voice] empty recognition cycle #" + emptyEndStreak + " (lastError=" + lastError + ", elapsed=" + elapsed + "ms)");
        if (emptyEndStreak >= 3) {
          if (lastError === "network") {
            addChatMessage("system-info",
              "Voice mode can't reach the speech-recognition service. This happens in privacy-focused browsers like Brave that disable Google's speech backend — use Chrome, Edge, Opera, or Vivaldi for Voice Mode. (If you're on one of those, check your internet connection.)");
            disable();
            return;
          }
          addChatMessage("system-info",
            "Voice mode can't capture audio (it keeps stopping instantly) — usually a microphone-permission issue. Click below to grant access via a quick permission page, then re-enable voice mode.");
          micPermissionHelp();
          disable();
          return;
        }
        try { rec.start(); } catch (e) {}
      };

      return rec;
    }

    // Offer a reliable way to grant mic permission: open the extension's
    // permission helper page in a normal tab, where the prompt always appears.
    function micPermissionHelp() {
      try {
        var url = chrome.runtime.getURL("mic-permission.html");
        addChatMessage("system-info", "Open the microphone permission page: " + url + " (or click the link if shown), allow access, then turn voice mode back on.");
        chrome.tabs.create({ url: url });
      } catch (e) {}
    }

    function onSilence() {
      // Include the latest interim — continuous-mode Chrome frequently never
      // emits a "final" result, so relying on finalTranscript alone hangs.
      var text = (finalTranscript + " " + lastInterim).trim();
      finalTranscript = "";
      lastInterim = "";
      setTranscript("");
      if (!text) return;            // genuine silence / noise — keep listening
      dispatchTranscript(text);
    }

    async function dispatchTranscript(text) {
      // Enter "thinking" — mic is ignored until we finish speaking the reply.
      setState("thinking");
      setTranscript("");
      lastInputWasVoice = true;

      var tabId = null, tabUrl = "", tabTitle = "";
      try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) { tabId = tabs[0].id || null; tabUrl = tabs[0].url || ""; tabTitle = tabs[0].title || ""; }
      } catch (e) {}

      // Classify chat vs agent (auto-routes action requests to the agent).
      var intent = "agent";
      try {
        var res = await sendMsg({ type: "CLASSIFY_MESSAGE", text: text, tabUrl: tabUrl, tabTitle: tabTitle });
        if (res && res.intent) intent = res.intent;
      } catch (e) { /* default agent */ }

      if (intent === "chat") {
        // Show the exchange on screen, then use the dedicated flirty voice path.
        addChatMessage("user", text);
        var vr = await sendMsg({ type: "VOICE_CHAT", text: text, tabId: tabId });
        var reply = (vr && vr.success && vr.content) ? vr.content : "";
        if (reply) addChatMessage("assistant", reply);
        lastInputWasVoice = false; // chat turn done — don't narrate later agent tasks
        speak(reply || "Hmm, I didn't quite catch that, say it again?");
      } else {
        if (isRunning) {
          lastInputWasVoice = false;
          speak("I'm already on something for you, hang tight.");
          return;
        }
        lastVoiceGoal = text;       // remembered so narrateDone can log the action
        agentWorking = true;        // mic stays OFF until the task finishes
        addChatMessage("user", text);
        speak("On it!");            // after this, resumeListening → "Working…" (no mic)
        // Always run on the current tab. lastInputWasVoice stays true so the
        // agent-log hooks narrate progress; narrateDone() resets it when done.
        agentSend(text, true, true); // alreadyEchoed=true (we echoed above)
      }
    }

    /* ── Text-to-speech ── */
    // Make an LLM reply sound natural spoken aloud: no markdown, code, emojis,
    // or raw URLs (which sound terrible read out).
    function plainTextForSpeech(md) {
      if (!md) return "";
      var s = String(md)
        .replace(/```[\s\S]*?```/g, " ")                  // fenced code → drop
        .replace(/`([^`]+)`/g, "$1")                       // inline code
        .replace(/\$\$[\s\S]*?\$\$/g, " ")                 // display math → drop
        .replace(/\$[^$\n]+\$/g, " ")                      // inline math → drop
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")             // images → drop
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")           // [text](url) → text
        // Raw URLs → just the site name, drop the rest.
        .replace(/\bhttps?:\/\/(?:www\.)?([^\/\s)]+)[^\s)]*/gi, function (_, host) {
          return (host || "").split(".")[0] || "a link";
        })
        .replace(/\bwww\.([^\/\s)]+)[^\s)]*/gi, function (_, host) {
          return (host || "").split(".")[0] || "a link";
        })
        .replace(/^#{1,6}\s+/gm, "")                        // headers
        .replace(/^\s*[-*+]\s+/gm, "")                      // bullet markers
        .replace(/^\s*\d+\.\s+/gm, "")                      // numbered markers
        .replace(/[*_~>#|`]/g, " ")                         // leftover md punctuation
        // Strip emoji & pictographs.
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️‍]/gu, "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")                   // tidy space before punctuation
        .trim();
      return s;
    }

    // Stop capturing audio without tearing voice mode down (mic OFF).
    function stopMic() {
      if (usingGroq) { groqPause(); return; }
      restartGuard = true;                 // block onend auto-restart
      try { recognition && recognition.stop(); } catch (e) {}
    }

    // Resume listening after a spoken reply. Always safe to call.
    // While a voice-dispatched agent task runs, the mic stays OFF and the bar
    // shows "Working…" instead — we only listen once the agent is done.
    function resumeListening() {
      if (!enabled) { setState("idle"); return; }
      if (agentWorking) { stopMic(); setState("working"); return; }
      setTimeout(function () {
        if (!enabled || agentWorking) { if (agentWorking) { stopMic(); setState("working"); } return; }
        restartGuard = false;
        setState("listening");
        if (usingGroq) { groqResume(); return; }
        try { recognition && recognition.start(); } catch (e) { /* already running */ }
      }, 250);
    }

    // On-device TTS. Watchdog + poll are essential: Chrome's SpeechSynthesis
    // often never fires onend after a few utterances, which would kill listening.
    function speak(text) {
      var clean = plainTextForSpeech(text);
      if (!clean || !window.speechSynthesis) { resumeListening(); return; }

      try { window.speechSynthesis.cancel(); } catch (e) {}
      setState("speaking");

      var utter = new SpeechSynthesisUtterance(clean.slice(0, 700));
      utter.lang = navigator.language || "en-US";
      utter.rate = 1.0;
      utter.pitch = 1.05; // a touch warmer
      var voice = pickVoice();
      if (voice) utter.voice = voice;

      var finished = false, watchdog = null, resumePoll = null;
      function finish() {
        if (finished) return;
        finished = true;
        if (watchdog) { clearTimeout(watchdog); watchdog = null; }
        if (resumePoll) { clearInterval(resumePoll); resumePoll = null; }
        resumeListening();
      }
      utter.onend = finish;
      utter.onerror = finish;

      var estMs = Math.min(Math.ceil(clean.length / 14) * 1000 + 1200, 22000);
      watchdog = setTimeout(finish, estMs);

      resumePoll = setInterval(function () {
        try {
          if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
            window.speechSynthesis.resume(); // Chrome silent-pause bug
          }
          if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
            finish(); // finished but onend may not have fired
          }
        } catch (e) {}
      }, 500);

      try { window.speechSynthesis.speak(utter); } catch (e) { finish(); }
    }

    // Pick the best female voice available, per browser:
    //  • Chrome → "Google US English" (its high-quality network female voice)
    //  • Edge   → "Aria"/"Jenny" Online (Natural) — Azure neural female voices
    //  • Brave  → Microsoft Zira (Brave strips the better voices, so the local
    //             named-female voice is used instead)
    //  • Others → a named female voice (Zira / Hazel / etc.) in your language.
    var cachedVoice = null;
    function pickVoice() {
      if (cachedVoice) return cachedVoice;
      var voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) return null;
      var twoLetter = (navigator.language || "en-US").toLowerCase().slice(0, 2);
      function isLang(v) { return v.lang && v.lang.toLowerCase().startsWith(twoLetter); }
      var FEMALE = /\b(zira|hazel|aria|jenny|ana|michelle|emma|ava|female|samantha|susan|fiona|tessa)\b/i;
      cachedVoice =
        // Chrome's Google voice in your language (female, best quality)
        voices.find(function(v){ return isLang(v) && /google/i.test(v.name); }) ||
        // Edge's Online (Natural) neural female voices (Aria / Jenny / …)
        voices.find(function(v){ return isLang(v) && /natural|online/i.test(v.name) && FEMALE.test(v.name); }) ||
        // Otherwise a named female voice in your language (Zira on Windows/Brave)
        voices.find(function(v){ return isLang(v) && FEMALE.test(v.name); }) ||
        voices.find(function(v){ return FEMALE.test(v.name); }) ||
        voices.find(isLang) ||
        voices[0];
      return cachedVoice;
    }

    /* ── Agent narration (called from agent-log hooks) ── */
    function narrate(text) {
      if (!enabled || !lastInputWasVoice) return;
      if (!text) return;
      // Drop-stale: if we're mid-speech, queue only the latest snippet.
      if (state === "speaking") { pendingNarration = text; return; }
      speak(text);
    }
    function narrateDone(summary) {
      if (!enabled || !lastInputWasVoice) return;
      lastInputWasVoice = false; // task finished — stop gating further narration
      agentWorking = false;      // task done → mic may resume after we speak
      pendingNarration = null;
      // Remember what we did so the companion can reference it later.
      if (lastVoiceGoal || summary) {
        try { sendMsg({ type: "VOICE_REMEMBER", goal: lastVoiceGoal, summary: summary || "" }); } catch (e) {}
      }
      lastVoiceGoal = "";
      if (summary) speak(summary);   // → resumeListening (agentWorking now false → listen)
      else resumeListening();        // no summary → just go back to listening
    }

    // Safety net: the agent can also end via error / user-stop, which never
    // fires narrateDone. Called on any terminal AGENT_STATUS so we never get
    // stuck in "Working…" with the mic off. Guarded so it won't fight a normal
    // spoken summary (which clears agentWorking immediately).
    function onAgentEnded() {
      if (!enabled) return;
      setTimeout(function () {
        if (!enabled || !agentWorking) return;   // narrateDone already handled it
        agentWorking = false;
        lastInputWasVoice = false;
        pendingNarration = null;
        lastVoiceGoal = "";
        if (state !== "speaking") resumeListening();
      }, 1200);
    }

    /* ── Lifecycle ── */
    async function enable() {
      // Decide the STT engine. Brave disables Google's speech backend for
      // privacy, so Chrome STT can't work there — auto-fall back to Groq.
      var brave = false;
      try {
        if (navigator.brave && typeof navigator.brave.isBrave === "function") {
          brave = await navigator.brave.isBrave();
        }
      } catch (e) { /* not Brave or detection failed */ }

      var engine = (sttConfig.engine === "groq") ? "groq" : "chrome";
      if (brave && engine !== "groq") engine = "groq";

      if (engine === "groq") {
        if (!groqSupported()) {
          addChatMessage("system-info", "Voice mode (Groq) needs microphone recording support, which isn't available in this browser.");
          return;
        }
        if (!sttConfig.groqKey) {
          addChatMessage("system-info", brave
            ? "Voice mode in Brave needs a Groq API key — Brave blocks Chrome's speech service. Add your free key in Settings → Speech-to-Text, then turn voice mode on. (Get one at console.groq.com)"
            : "Groq transcription is selected but no API key is set. Add your Groq key in Settings → Speech-to-Text, or switch the engine back to Browser (Chrome).");
          openSettingsToStt();
          return;
        }
        usingGroq = true;
      } else {
        if (!supported()) {
          addChatMessage("system-info", "Voice mode isn't supported in this browser (needs Web Speech API). Use Chrome, Edge, Opera, or Vivaldi — or switch to Groq transcription in Settings → Speech-to-Text.");
          return;
        }
        usingGroq = false;
      }

      enabled = true;
      finalTranscript = "";
      lastInterim = "";
      restartGuard = false;
      // Warm up the voice list (async on some platforms).
      if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged === null) {
        window.speechSynthesis.onvoiceschanged = function(){ cachedVoice = null; pickVoice(); };
      }
      if (voiceBtn) { voiceBtn.classList.add("active"); voiceBtn.setAttribute("aria-pressed", "true"); }
      showOverlay(true);
      setState("listening");
      setTranscript("");

      if (usingGroq) {
        groqStart();
        return;
      }

      // Chrome path: best-effort permission warm-up, then start recognition
      // (which requests the mic itself and surfaces denials via onerror).
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(function(t){ t.stop(); });
        }
      } catch (e) { /* don't abort — recognition.start() will prompt/error */ }
      recognition = buildRecognition();
      try { recognition.start(); } catch (e) {}
    }

    // Open the settings drawer focused on the Speech-to-Text section so the
    // user can drop in their Groq key right away.
    function openSettingsToStt() {
      try {
        if (settingsDrawer && !settingsDrawer.classList.contains("open") && settingsBtn) {
          settingsBtn.click();
        }
        if (cfgGroqKey) setTimeout(function(){ try { cfgGroqKey.focus(); } catch (e) {} }, 150);
      } catch (e) {}
    }

    function disable() {
      enabled = false;
      restartGuard = true;
      lastInputWasVoice = false;
      agentWorking = false;
      pendingNarration = null;
      lastVoiceGoal = "";
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      try { recognition && recognition.stop(); } catch (e) {}
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
      recognition = null;
      if (usingGroq) groqStop();
      usingGroq = false;
      // Clear the voice conversation memory (fresh session next time).
      try { sendMsg({ type: "VOICE_RESET" }); } catch (e) {}
      if (voiceBtn) { voiceBtn.classList.remove("active"); voiceBtn.setAttribute("aria-pressed", "false"); }
      showOverlay(false);
      setState("idle");
      setTranscript("");
    }

    function toggle() { enabled ? disable() : enable(); }

    return {
      toggle: toggle,
      enable: enable,
      disable: disable,
      isActive: function() { return enabled; },
      narrate: narrate,
      narrateDone: narrateDone,
      onAgentEnded: onAgentEnded
    };
  })();

  /* ═══════════════════════════════════════════
   * Stop Agent
   * ═══════════════════════════════════════════ */

  async function stopAgent() {
    await sendMsg({ type: "STOP_AGENT" });
    isRunning = false;
    updateButtons();
    setStatus("idle", "Stopped by user.");
    VoiceController.onAgentEnded(); // exit "Working…" + resume mic (guarded)
  }

  /* ── UI helpers ── */
  function updateButtons() {
    if (isRunning) {
      inputActions.classList.add("hidden");
      stopActions.classList.remove("hidden");
      goalInput.disabled = true;
      activityBar.classList.add("active");
      stopPlaceholderRotation();
    } else {
      inputActions.classList.remove("hidden");
      stopActions.classList.add("hidden");
      goalInput.disabled = false;
      activityBar.classList.remove("active");
      hideThinkingIndicator();
      startPlaceholderRotation();
    }
  }

  function setStatus(type, message) {
    statusDot.className = "status-dot";
    if (type === "active" || type === "capturing" || type === "acting") {
      statusDot.classList.add("active");
    } else if (type === "thinking") {
      statusDot.classList.add("thinking");
    } else if (type === "error" || type === "stopped") {
      statusDot.classList.add("error");
    }
    statusMsg.textContent = message;
  }

  function clearStream() {
    seenLogIds = {};
    agentLogBubble = null;
    agentLogSteps = null;
    thinkingEl = null;
    agentStepCount = 0;
    lastShownLabel = "";
    isReplaying = false;
    var children = Array.from(streamInner.children);
    children.forEach(function(c) {
      if (c !== streamEmpty && c !== chatTyping) c.remove();
    });
    streamEmpty.style.display = "";
    currentMode = null;
    modeChip.classList.add("hidden");
    stepChip.classList.add("hidden");
    // Re-trigger tagline animation and refresh suggestion chips
    var tagEl = document.getElementById("taglineText");
    if (tagEl) { tagEl.textContent = ""; tagEl.classList.remove("done"); }
    typeTagline();
    renderRandomChips();
    updateEmptyState(loadedProviders);
  }

  /* ═══════════════════════════════════════════
   * Workflow UI
   * ═══════════════════════════════════════════ */

  var pendingReplayWorkflowId = null;
  var pendingReplayTabId = null;
  var pendingReplayName = "";

  function toggleWorkflows() {
    workflowDrawer.classList.toggle("open");
    workflowBtn.classList.toggle("active");
    if (workflowDrawer.classList.contains("open")) {
      loadWorkflowList();
      settingsDrawer.classList.remove("open");
      settingsBtn.classList.remove("active");
      personalInfoDrawer.classList.remove("open");
      personalInfoBtn.classList.remove("active");
    }
  }

  /* ═══════════════════════════════════════════
   * Personal Info
   * ═══════════════════════════════════════════ */

  function togglePersonalInfo() {
    personalInfoDrawer.classList.toggle("open");
    personalInfoBtn.classList.toggle("active");
    if (personalInfoDrawer.classList.contains("open")) {
      loadPersonalInfo();
      settingsDrawer.classList.remove("open");
      settingsBtn.classList.remove("active");
      workflowDrawer.classList.remove("open");
      workflowBtn.classList.remove("active");
    }
  }

  function readPersonalInfo() {
    var info = {};
    document.querySelectorAll("[data-pinfo]").forEach(function(inp) {
      info[inp.getAttribute("data-pinfo")] = inp.value.trim();
    });
    info.customFields = [];
    for (var i = 0; i < 5; i++) {
      var l = document.querySelector('[data-pinfo-label="' + i + '"]');
      var v = document.querySelector('[data-pinfo-value="' + i + '"]');
      if (l && v && (l.value.trim() || v.value.trim())) {
        info.customFields.push({ label: l.value.trim(), value: v.value.trim() });
      }
    }
    return info;
  }

  function writePersonalInfo(info) {
    if (!info) return;
    document.querySelectorAll("[data-pinfo]").forEach(function(inp) {
      var k = inp.getAttribute("data-pinfo");
      if (info[k] != null) inp.value = info[k];
    });
    var c = info.customFields || [];
    for (var i = 0; i < 5; i++) {
      var l = document.querySelector('[data-pinfo-label="' + i + '"]');
      var v = document.querySelector('[data-pinfo-value="' + i + '"]');
      if (l) l.value = c[i] ? c[i].label || "" : "";
      if (v) v.value = c[i] ? c[i].value || "" : "";
    }
  }

  async function loadPersonalInfo() {
    var r = await sendMsg({ type: "LOAD_PERSONAL_INFO" });
    if (r && r.info) writePersonalInfo(r.info);
  }

  async function savePersonalInfo() {
    await sendMsg({ type: "SAVE_PERSONAL_INFO", info: readPersonalInfo() });
    togglePersonalInfo();
  }

  async function loadWorkflowList() {
    var result = await sendMsg({ type: "WF_LIST" });
    if (!result || !result.success) return;
    var workflows = result.workflows || [];
    workflowList.innerHTML = "";

    if (workflows.length === 0) {
      workflowList.innerHTML = '<div class="workflow-empty">No saved workflows yet. Start recording to create one.</div>';
      return;
    }

    workflows.forEach(function(wf) {
      var item = document.createElement("div");
      item.className = "workflow-item";

      // Build step list HTML with edit/remove buttons
      var stepsHtml = '';
      if (wf.steps && wf.steps.length > 0) {
        stepsHtml = '<div class="workflow-step-list"><ol>';
        wf.steps.forEach(function(s, si) {
          var editable = (s.action === "type" || s.action === "navigate");
          var editVal = s.action === "navigate" ? (s.url || "") : (s.value || "");
          stepsHtml += '<li>' +
            '<span class="step-text">' + esc(s.description || s.action || 'Step') + '</span>' +
            '<span class="step-actions">' +
              (editable ? '<button class="step-action-btn edit" data-wfid="' + esc(wf.id) + '" data-si="' + si + '" data-val="' + esc(editVal) + '" title="Edit"><svg viewBox="0 0 24 24"><path d="M17 3l4 4L7 21H3v-4L17 3z"/></svg></button>' : '') +
              '<button class="step-action-btn remove" data-wfid="' + esc(wf.id) + '" data-si="' + si + '" title="Remove"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
            '</span>' +
          '</li>';
        });
        stepsHtml += '</ol></div>';
      }

      item.innerHTML =
        '<div class="workflow-item-info">' +
          '<div class="workflow-item-name">' + esc(wf.name) + '</div>' +
          '<div class="workflow-item-meta">' + wf.steps.length + ' steps <span class="expand-arrow">&#9654;</span></div>' +
        '</div>' +
        '<div class="workflow-item-btns">' +
          '<button class="wf-item-btn play" title="Replay"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>' +
          '<button class="wf-item-btn delete" title="Delete"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>' +
        '</div>' +
        stepsHtml;

      // Toggle expand on click (but not on button clicks)
      item.addEventListener("click", function(e) {
        if (e.target.closest(".wf-item-btn") || e.target.closest(".step-action-btn")) return;
        item.classList.toggle("expanded");
      });

      item.querySelector(".play").addEventListener("click", function(e) {
        e.stopPropagation();
        startReplayFlow(wf.id);
      });
      item.querySelector(".delete").addEventListener("click", function(e) {
        e.stopPropagation();
        wfDeleteWorkflow(wf.id);
      });

      // Step-level edit/remove via event delegation
      var stepList = item.querySelector(".workflow-step-list");
      if (stepList) {
        stepList.addEventListener("click", function(e) {
          var btn = e.target.closest(".step-action-btn");
          if (!btn) return;
          e.stopPropagation();
          var wfid = btn.getAttribute("data-wfid");
          var si = parseInt(btn.getAttribute("data-si"), 10);

          if (btn.classList.contains("remove")) {
            sendMsg({ type: "WF_REMOVE_STEP", workflowId: wfid, stepIndex: si })
              .then(function() { loadWorkflowList(); });
          } else if (btn.classList.contains("edit")) {
            var curVal = btn.getAttribute("data-val") || "";
            var newVal = prompt("Edit value:", curVal);
            if (newVal !== null && newVal !== "") {
              sendMsg({ type: "WF_EDIT_STEP", workflowId: wfid, stepIndex: si, newValue: newVal })
                .then(function() { loadWorkflowList(); });
            }
          }
        });
      }

      workflowList.appendChild(item);
    });
  }

  async function wfStartRecording() {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    if (!tab) return;

    var result = await sendMsg({ type: "WF_START_RECORDING", tabId: tab.id });
    if (result && result.success) {
      isRecording = true;
      recordingBar.classList.remove("hidden");
      recordBtn.disabled = true;
      recordBtn.textContent = "Recording...";
      recStepCount.textContent = "0";
      addChatMessage("system-info", "Recording started. Navigate and interact with pages — I'll capture everything.");
      workflowDrawer.classList.remove("open");
      workflowBtn.classList.remove("active");
    }
  }

  async function wfStopRecording() {
    var name = prompt("Name this workflow:", "Workflow " + new Date().toLocaleString());
    if (name === null) return; // cancelled

    var result = await sendMsg({ type: "WF_STOP_RECORDING", name: name });
    isRecording = false;
    recordingBar.classList.add("hidden");
    recordBtn.disabled = false;
    recordBtn.textContent = "Start Recording";

    if (result && result.success && result.workflow) {
      addChatMessage("system-info", "Workflow saved: " + result.workflow.name + " (" + result.workflow.steps.length + " steps)");
    }
  }

  async function startReplayFlow(workflowId) {
    // Check if workflow has params — if so, show param form first
    var result = await sendMsg({ type: "WF_GET_PARAMS", workflowId: workflowId });
    if (!result || !result.success) return;

    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    if (!tab) return;

    pendingReplayWorkflowId = workflowId;
    pendingReplayTabId = tab.id;
    pendingReplayName = result.workflowName || "";

    if (result.params && result.params.length > 0) {
      // Show parameter form
      paramTitle.textContent = (result.workflowName || "Workflow") + " — Parameters";
      paramFields.innerHTML = "";
      result.params.forEach(function(p) {
        var div = document.createElement("div");
        div.className = "param-field";
        div.innerHTML = '<label>' + esc(p.paramName) + '</label>' +
          '<input type="text" data-param="' + esc(p.paramName) + '" value="' + esc(p.defaultValue || "") + '" />';
        paramFields.appendChild(div);
      });
      paramOverlay.classList.remove("hidden");
    } else {
      // No params — start replay directly
      executeReplay(workflowId, tab.id, {}, result.workflowName);
    }
  }

  function collectParamValues() {
    var vals = {};
    var inputs = paramFields.querySelectorAll("input[data-param]");
    inputs.forEach(function(inp) {
      vals[inp.getAttribute("data-param")] = inp.value;
    });
    return vals;
  }

  async function executeReplay(workflowId, tabId, paramValues, workflowName) {
    createReplayLog(workflowName || "");
    workflowDrawer.classList.remove("open");
    workflowBtn.classList.remove("active");

    var result = await sendMsg({ type: "WF_REPLAY", workflowId: workflowId, tabId: tabId, paramValues: paramValues });
    if (!result || !result.success) {
      addReplayStep((result && result.error) || "Couldn't start replay.", "error");
      finishReplayLog("Replay failed", false);
    }
  }

  async function wfDeleteWorkflow(workflowId) {
    if (!confirm("Delete this workflow?")) return;
    await sendMsg({ type: "WF_DELETE", workflowId: workflowId });
    loadWorkflowList();
  }

  // Event bindings for workflow UI
  workflowBtn.addEventListener("click", toggleWorkflows);
  closeWorkflowBtn.addEventListener("click", toggleWorkflows);
  recordBtn.addEventListener("click", wfStartRecording);
  stopRecordBtn.addEventListener("click", wfStopRecording);
  resumeReplayBtn.addEventListener("click", function() {
    replayPausedBar.classList.add("hidden");
    sendMsg({ type: "WF_RESUME_REPLAY" });
  });
  paramRunBtn.addEventListener("click", function() {
    var vals = collectParamValues();
    paramOverlay.classList.add("hidden");
    if (pendingReplayWorkflowId) {
      executeReplay(pendingReplayWorkflowId, pendingReplayTabId, vals, pendingReplayName);
    }
  });
  paramCancelBtn.addEventListener("click", function() {
    paramOverlay.classList.add("hidden");
    pendingReplayWorkflowId = null;
  });

  /* ── Provider Tab Switching ── */
  function initProviderTabs() {
    var tabs = providerTabs.querySelectorAll(".provider-tab");
    tabs.forEach(function(tab) {
      tab.addEventListener("click", function() {
        selectProviderTab(tab.getAttribute("data-provider"));
      });
    });
  }

  function selectProviderTab(provider) {
    selectedProvider = provider;
    var tabs = providerTabs.querySelectorAll(".provider-tab");
    tabs.forEach(function(t) {
      t.classList.toggle("selected", t.getAttribute("data-provider") === provider);
    });
    PROVIDERS.forEach(function(p) {
      var panel = document.getElementById("cfg-" + p);
      if (panel) panel.classList.toggle("active", p === provider);
    });
  }

  function readProviderFields() {
    var providers = {};
    PROVIDERS.forEach(function(p) {
      providers[p] = {};
      document.querySelectorAll('[data-cfg^="' + p + '."]').forEach(function(inp) {
        var key = inp.getAttribute("data-cfg").split(".")[1];
        var val = inp.value.trim();
        if (val === "__custom__" && inp.tagName === "SELECT") {
          var ci = inp.parentElement.querySelector('input[id$="Custom"]');
          if (ci) val = ci.value.trim();
        }
        providers[p][key] = val;
      });
    });
    return providers;
  }

  function writeProviderFields(providers) {
    if (!providers) return;
    PROVIDERS.forEach(function(p) {
      if (!providers[p]) return;
      Object.keys(providers[p]).forEach(function(key) {
        var inp = document.querySelector('[data-cfg="' + p + "." + key + '"]');
        if (!inp) return;
        var val = providers[p][key] || "";
        if (inp.tagName === "SELECT") {
          var exists = Array.from(inp.options).some(function(o) { return o.value === val; });
          var ci = inp.parentElement.querySelector('input[id$="Custom"]');
          if (exists) {
            inp.value = val;
            if (ci) ci.classList.add("hidden");
          } else {
            inp.value = "__custom__";
            if (ci) { ci.value = val; ci.classList.remove("hidden"); }
          }
        } else {
          inp.value = val;
        }
      });
    });
  }

  /* ── Settings ── */
  function toggleSettings() {
    settingsDrawer.classList.toggle("open");
    settingsBtn.classList.toggle("active");
    if (settingsDrawer.classList.contains("open")) {
      personalInfoDrawer.classList.remove("open");
      personalInfoBtn.classList.remove("active");
      workflowDrawer.classList.remove("open");
      workflowBtn.classList.remove("active");
    }
  }

  async function saveSettings() {
    var providers = readProviderFields();
    var config = {
      provider: selectedProvider,
      providers: providers,
      maxSteps: parseInt(cfgMaxSteps.value, 10) || 20,
      interStepDelay: parseInt(cfgDelay.value, 10) || 2000,
      llmTimeout: parseInt(cfgTimeout.value, 10) || 100000,
      wallTimeout: (parseInt(cfgWallTimeout.value, 10) || 300) * 1000,
      sttEngine: (cfgSttEngine && cfgSttEngine.value === "groq") ? "groq" : "chrome",
      groqApiKey: cfgGroqKey ? cfgGroqKey.value.trim() : ""
    };
    sttConfig.engine = config.sttEngine;
    sttConfig.groqKey = config.groqApiKey;
    await sendMsg({ type: "SAVE_CONFIG", config: config });
    loadedProviders = providers;
    updateEmptyState(providers);
    toggleSettings();
  }

  /* ═══════════════════════════════════════════
   * Init
   * ═══════════════════════════════════════════ */

  async function init() {
    initProviderTabs();

    var status = await sendMsg({ type: "GET_STATUS" });
    if (status) {
      isRunning = status.running;
      if (status.goal) goalInput.value = status.goal;
      stepChip.textContent = (status.step || 0) + " / " + (status.maxSteps || 20);
      updateButtons();

      if (status.running) {
        // Restore agent view — replay logs into a chat-style agent log bubble
        currentMode = "agent";
        modeChip.textContent = "AGENT";
        modeChip.className = "mode-chip agent";
        modeChip.classList.remove("hidden");
        stepChip.classList.remove("hidden");
        createAgentLogBubble(status.goal || "");

        if (status.logs) {
          isReplaying = true;
          status.logs.forEach(function(log) {
            if (seenLogIds[log.id]) return;
            seenLogIds[log.id] = true;
            addAgentStep(log);
          });
          isReplaying = false;
        }
      }
    }

    var cfgRes = await sendMsg({ type: "LOAD_CONFIG" });
    if (cfgRes && cfgRes.config) {
      var cfg = cfgRes.config;
      selectedProvider = cfg.provider || "ollama_cloud";
      selectProviderTab(selectedProvider);
      if (cfg.providers) writeProviderFields(cfg.providers);
      cfgMaxSteps.value = cfg.maxSteps || 20;
      cfgDelay.value    = cfg.interStepDelay || 2000;
      cfgTimeout.value  = cfg.llmTimeout || 100000;
      cfgWallTimeout.value = Math.round((cfg.wallTimeout || 300000) / 1000);
      sttConfig.engine = (cfg.sttEngine === "groq") ? "groq" : "chrome";
      sttConfig.groqKey = cfg.groqApiKey || "";
      if (cfgSttEngine) cfgSttEngine.value = sttConfig.engine;
      if (cfgGroqKey) cfgGroqKey.value = sttConfig.groqKey;
      loadedProviders = cfg.providers || {};
    }

    stream.addEventListener("scroll", function() {
      var s = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      autoScroll = s < 60;
    });

    startPlaceholderRotation();
    renderRandomChips();
    updateEmptyState(loadedProviders);

    // Tagline typewriter animation
    typeTagline();
  }

  function typeTagline() {
    var el = document.getElementById("taglineText");
    if (!el) return;
    var line1 = "Stop browsing.";
    var line2 = " Start delegating.";
    var full = line1 + line2;
    var i = 0;
    var speed = 55; // ms per character
    var pauseAfterLine1 = 400; // pause between the two sentences

    function tick() {
      if (i < full.length) {
        el.textContent = full.slice(0, i + 1);
        i++;
        // Pause after the period in "Stop browsing."
        var delay = (i === line1.length) ? pauseAfterLine1 : speed;
        setTimeout(tick, delay);
      } else {
        // Typing done — trigger glow sweep
        el.classList.add("done");
      }
    }

    // Small delay before typing starts so orb animation lands first
    setTimeout(tick, 700);
  }

  /* ═══════════════════════════════════════════
   * Listen for broadcasts
   * ═══════════════════════════════════════════ */

  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.type === "AGENT_STATUS") {
      isRunning = msg.running;
      updateButtons();
      setStatus(msg.status, msg.message || "");
      stepChip.textContent = (msg.step || 0) + " / " + (msg.maxSteps || 20);

      if (msg.status === "thinking") {
        showThinkingIndicator();
      }
      if (msg.status === "done" || msg.status === "error" || msg.status === "stopped" || msg.status === "idle") {
        isRunning = false;
        updateButtons();
        hideThinkingIndicator();
        VoiceController.onAgentEnded(); // exit "Working…" + resume mic (guarded)
      }
    }

    if (msg.type === "AGENT_LOG") {
      var log = msg.log;
      if (seenLogIds[log.id]) return;
      seenLogIds[log.id] = true;
      addAgentStep(log);
    }

    // Workflow recording status
    if (msg.type === "WORKFLOW_STATUS") {
      if (msg.recording) {
        recStepCount.textContent = msg.stepCount || 0;
      }
    }

    // Workflow replay progress — streamed into the chat-like replay log bubble
    if (msg.type === "REPLAY_STATUS") {
      if (msg.replaying) {
        if (msg.description) {
          addReplayStep("Step " + msg.step + " of " + msg.total + " — " + msg.description, "done");
        }
      } else {
        finishReplayLog(msg.message || "Replay complete", msg.status !== "error");
        replayPausedBar.classList.add("hidden");
      }
    }

    // Replay paused (login wall, etc.)
    if (msg.type === "REPLAY_PAUSED") {
      pauseLabel.textContent = msg.reason || "Paused";
      addReplayStep("Paused — " + (msg.reason || "waiting for you"), "acting");
      replayPausedBar.classList.remove("hidden");
    }


  });

  /* ═══════════════════════════════════════════
   * Event Bindings
   * ═══════════════════════════════════════════ */

  sendBtn.addEventListener("click", function() {
    if (isRunning) return;
    var text = goalInput.value.trim();
    if (text) routeMessage(text);
  });

  stopBtn.addEventListener("click", stopAgent);

  if (voiceBtn) voiceBtn.addEventListener("click", function() { VoiceController.toggle(); });
  if (voiceCloseBtn) voiceCloseBtn.addEventListener("click", function() { VoiceController.disable(); });

  clearLogsBtn.addEventListener("click", function() {
    clearStream();
    sendMsg({ type: "CHAT_END" });
  });

  settingsBtn.addEventListener("click", toggleSettings);
  saveBtn.addEventListener("click", saveSettings);
  closeCfgBtn.addEventListener("click", toggleSettings);
  if (noApiSettingsBtn) noApiSettingsBtn.addEventListener("click", toggleSettings);

  // Ollama Cloud model dropdowns — show/hide custom input
  function setupModelDropdown(selectId, customId) {
    var sel = document.getElementById(selectId);
    var cust = document.getElementById(customId);
    if (!sel || !cust) return;
    sel.addEventListener("change", function() {
      if (sel.value === "__custom__") { cust.classList.remove("hidden"); cust.focus(); }
      else { cust.classList.add("hidden"); cust.value = ""; }
    });
  }
  setupModelDropdown("ollamaCloudModel", "ollamaCloudModelCustom");
  setupModelDropdown("ollamaCloudVisionModel", "ollamaCloudVisionModelCustom");
  setupModelDropdown("ollamaCloudChatModel", "ollamaCloudChatModelCustom");

  // Personal Info
  personalInfoBtn.addEventListener("click", togglePersonalInfo);
  document.getElementById("closePersonalInfoBtn").addEventListener("click", togglePersonalInfo);
  document.getElementById("cancelPersonalInfoBtn").addEventListener("click", togglePersonalInfo);
  document.getElementById("savePersonalInfoBtn").addEventListener("click", savePersonalInfo);


  // Keyboard: Enter = smart auto-route (chat vs agent); Ctrl+Enter = force Agent
  goalInput.addEventListener("keydown", function(e) {
    if (isRunning) return;
    var text = goalInput.value.trim();
    if (!text) return;

    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      routeMessage(text);
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      routeMessage(text, { forceAgent: true });
    }
  });

  goalInput.addEventListener("input", function() {
    goalInput.style.height = "auto";
    goalInput.style.height = Math.min(goalInput.scrollHeight, 200) + "px";
  });

  goalInput.addEventListener("focus", stopPlaceholderRotation);
  goalInput.addEventListener("blur", function() {
    if (!isRunning) startPlaceholderRotation();
  });

  /* ── Chat mode pill (Quick / Pro) ── */
  function renderChatMode() {
    if (!chatModePill) return;
    chatModePill.setAttribute("data-mode", chatMode);
    if (chatModePillLabel) chatModePillLabel.textContent = chatMode === "pro" ? "Pro" : "Quick";
    if (chatModePopover) {
      var opts = chatModePopover.querySelectorAll(".chat-mode-option");
      for (var i = 0; i < opts.length; i++) {
        opts[i].classList.toggle("active", opts[i].getAttribute("data-value") === chatMode);
      }
    }
  }

  function openChatModePopover() {
    if (!chatModePopover || !chatModePill) return;
    chatModePopover.classList.remove("hidden");
    chatModePill.classList.add("open");
    chatModePill.setAttribute("aria-expanded", "true");
  }

  function closeChatModePopover() {
    if (!chatModePopover || !chatModePill) return;
    chatModePopover.classList.add("hidden");
    chatModePill.classList.remove("open");
    chatModePill.setAttribute("aria-expanded", "false");
  }

  function setChatMode(mode) {
    chatMode = mode === "pro" ? "pro" : "quick";
    try { localStorage.setItem("webwright.chatMode", chatMode); } catch (e) {}
    renderChatMode();
  }

  renderChatMode();

  if (chatModePill) {
    chatModePill.addEventListener("click", function(e) {
      e.stopPropagation();
      if (chatModePopover && chatModePopover.classList.contains("hidden")) {
        openChatModePopover();
      } else {
        closeChatModePopover();
      }
    });
  }

  if (chatModePopover) {
    chatModePopover.addEventListener("click", function(e) {
      var opt = e.target.closest(".chat-mode-option");
      if (!opt) return;
      setChatMode(opt.getAttribute("data-value"));
      closeChatModePopover();
    });
  }

  document.addEventListener("click", function(e) {
    if (!chatModePopover || chatModePopover.classList.contains("hidden")) return;
    if (chatModePill && chatModePill.contains(e.target)) return;
    if (chatModePopover.contains(e.target)) return;
    closeChatModePopover();
  });

  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && chatModePopover && !chatModePopover.classList.contains("hidden")) {
      closeChatModePopover();
    }
  });

  /* ── Boot ── */
  init();
})();
