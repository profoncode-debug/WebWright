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
  var chatBtn        = document.getElementById("chatBtn");
  var agentBtn       = document.getElementById("agentBtn");
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
  var saveBtn        = document.getElementById("saveBtn");
  var closeCfgBtn    = document.getElementById("closeCfgBtn");
  var activityBar    = document.getElementById("activityBar");
  var chatTyping     = document.getElementById("chatTyping");
  var providerTabs   = document.getElementById("providerTabs");
  var tabChoiceOverlay = document.getElementById("tabChoiceOverlay");
  var tabChoiceThis  = document.getElementById("tabChoiceThis");
  var tabChoiceNew   = document.getElementById("tabChoiceNew");
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
  var researchBtn    = document.getElementById("researchBtn");
  var researchDrawer = document.getElementById("researchDrawer");
  var researchQueryInput = document.getElementById("researchQueryInput");
  var researchStartBtn = document.getElementById("researchStartBtn");
  var researchAbortBtn = document.getElementById("researchAbortBtn");
  var researchProgress = document.getElementById("researchProgress");
  var researchSourceList = document.getElementById("researchSourceList");
  var researchViewBtn = document.getElementById("researchViewBtn");
  var researchReportsSection = document.getElementById("researchReportsSection");
  var researchReportsList = document.getElementById("researchReportsList");
  var noApiBanner    = document.getElementById("noApiBanner");
  var noApiSettingsBtn = document.getElementById("noApiSettingsBtn");

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
  var pendingAgentText = ""; // Text waiting for tab choice

  var PROVIDERS = ["ollama_cloud", "ollama_local", "chatgpt", "claude", "gemini", "deepseek", "grok", "custom"];

  /* ── Rotating Placeholders ── */
  var placeholders = [
    "LLM timing out? Increase timeout",
    "Vision escalates automatically ",
    "Set a Vision model if not done yet.",
    "Long tasks? Use Kimi k 2.5 ",
    "Speed up tasks — lower Step Delay ",
    "More steps? Raise Max Steps in Settings",
    "Agent looping? Try a smarter model",
    "Payments & passwords need your input",
    "Ctrl+Enter to run agent mode",
    "Enter = chat  •  Ctrl+Enter = automate",
    "Claude Sonnet 4.6 best for paid",
    "Agent hallucinating? Try better models."
  ];

  /* ── Suggestion Pool (50+) ── */
  var SUGGESTION_POOL = [
    // Navigation
    { text: "Open Instagram", desc: "Opens Instagram feed", icon: "nav" },
    { text: "Open Instagram Reels", desc: "Opens Instagram Reels", icon: "nav" },
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
    { text: "Open Notion", desc: "Opens your Notion workspace", icon: "nav" },
    { text: "Open Google Docs", desc: "Opens Google Docs homepage", icon: "nav" },
    // Productivity
    { text: "Check my Gmail inbox", desc: "Opens Gmail and shows unread emails", icon: "mail" },
    { text: "Check my Outlook mail", desc: "Opens Outlook inbox", icon: "mail" },
    { text: "Open Google Calendar", desc: "Opens your Google Calendar", icon: "calendar" },
    { text: "Open Google Drive", desc: "Opens your Google Drive files", icon: "file" },
    { text: "Create a new Google Doc", desc: "Opens a blank Google Doc", icon: "file" },
    { text: "Search Google for latest news", desc: "Searches for today's news", icon: "search" },
    // Shopping
    { text: "Open Amazon", desc: "Opens Amazon homepage", icon: "shop" },
    { text: "Open Flipkart", desc: "Opens Flipkart homepage", icon: "shop" },
    { text: "Open Myntra", desc: "Opens Myntra for shopping", icon: "shop" },
    { text: "Order food from Swiggy", desc: "Opens Swiggy for food delivery", icon: "shop" },
    { text: "Open Zomato", desc: "Opens Zomato for food delivery", icon: "shop" },
    { text: "Search Amazon for headphones", desc: "Finds headphones on Amazon", icon: "search" },
    { text: "Compare prices for laptops", desc: "Searches for laptop deals", icon: "search" },
    // Information
    { text: "Check today's weather", desc: "Opens weather site and reports conditions", icon: "weather" },
    { text: "What's trending on Twitter", desc: "Shows trending topics", icon: "search" },
    { text: "Check stock market today", desc: "Opens stock market summary", icon: "search" },
    { text: "Show cricket live scores", desc: "Opens live cricket scores", icon: "search" },
    { text: "Search for flights to Delhi", desc: "Finds flights on Google Flights", icon: "search" },
    { text: "Search for flights to Tokyo", desc: "Finds flights to Tokyo", icon: "search" },
    { text: "Find hotels in Goa", desc: "Searches for hotel deals in Goa", icon: "search" },
    { text: "What's the latest tech news", desc: "Searches for technology news", icon: "search" },
    { text: "Convert 100 USD to INR", desc: "Checks currency conversion rate", icon: "search" },
    { text: "Find recipe for biryani", desc: "Searches for biryani recipe", icon: "search" },
    // Page actions (chat mode)
    { text: "Summarize this tab", desc: "Get a quick summary of the current page", icon: "doc", mode: "chat" },
    { text: "Summarize this article", desc: "Summarize the main article on this page", icon: "doc", mode: "chat" },
    { text: "What does this page say?", desc: "Quick overview of page content", icon: "doc", mode: "chat" },
    { text: "Explain this page simply", desc: "Explains the page in simple terms", icon: "doc", mode: "chat" },
    { text: "List key points from this page", desc: "Extracts main points", icon: "doc", mode: "chat" },
    // Social
    { text: "Post a tweet", desc: "Opens Twitter to compose a tweet", icon: "nav" },
    { text: "Check Instagram DMs", desc: "Opens Instagram direct messages", icon: "nav" },
    { text: "Search YouTube for tutorials", desc: "Searches YouTube for tutorial videos", icon: "search" },
    // Utilities
    { text: "Translate this page to English", desc: "Uses Google Translate on this page", icon: "search" },
    { text: "Find the best restaurant nearby", desc: "Searches for top-rated restaurants", icon: "search" },
    { text: "Check my internet speed", desc: "Opens speed test website", icon: "search" },
    { text: "Check train tickets on IRCTC", desc: "Opens IRCTC for train booking", icon: "search" },
    { text: "Book an Uber ride", desc: "Opens Uber for ride booking", icon: "nav" },
    { text: "Find coupon codes for this site", desc: "Searches for discount codes", icon: "search" },
    { text: "Download this page as PDF", desc: "Helps save the page as PDF", icon: "file" },
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
          goalInput.value = text;
          if (mode === "chat" || text.toLowerCase().indexOf("summarize") >= 0) {
            chatSend(text);
          } else {
            showTabChoice(text);
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
   * Markdown Parser (lightweight)
   * ═══════════════════════════════════════════ */

  function renderMarkdown(text) {
    if (!text) return "";
    var s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) { return '<pre><code>' + code.trim() + '</code></pre>'; });
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    s = s.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    s = s.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    s = s.replace(/^---$/gm, '<hr>');
    s = s.replace(/(?:^|\n)((?:[\-\*]\s+.+\n?)+)/g, function(_, block) {
      var items = block.trim().split(/\n/).map(function(line) {
        return '<li>' + line.replace(/^[\-\*]\s+/, '') + '</li>';
      }).join('');
      return '<ul>' + items + '</ul>';
    });
    s = s.replace(/(?:^|\n)((?:\d+\.\s+.+\n?)+)/g, function(_, block) {
      var items = block.trim().split(/\n/).map(function(line) {
        return '<li>' + line.replace(/^\d+\.\s+/, '') + '</li>';
      }).join('');
      return '<ol>' + items + '</ol>';
    });
    s = s.replace(/\n\n+/g, '</p><p>');
    if (!s.match(/^<(h[1-6]|ul|ol|pre|blockquote|hr)/)) s = '<p>' + s + '</p>';
    s = s.replace(/<p><\/(h[1-6]|ul|ol|pre|blockquote|hr)>/g, '</$1>');
    s = s.replace(/<(h[1-6]|ul|ol|pre|blockquote|hr)([^>]*)><\/p>/g, '<$1$2>');
    s = s.replace(/<p>\s*<\/p>/g, '');
    s = s.replace(/([^>])\n([^<])/g, '$1<br>$2');
    return s;
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
      return;
    }

    // Handle progress report
    if (kind === "system" && label && label.indexOf("Progress") >= 0) {
      var progSummary = data.summary || data.reason || "Partial progress made.";
      finishAgentLog("progress", progSummary);
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
            '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
            'Agent Completed';
          header.style.color = "var(--green)";
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

    // Add summary
    var summaryEl = document.createElement("div");
    summaryEl.className = "agent-done-summary";
    // Parse bullet points from summary (lines starting with "- ")
    if (typeof summary !== "string") summary = Array.isArray(summary) ? summary.join("\n") : String(summary || "Task complete!");
    summary = summary.trim() || "Task complete!";
    var bulletLines = summary.split(/\r?\n/).filter(function(l) { return l.trim().indexOf("- ") === 0; });
    if (bulletLines.length > 0) {
      var listHtml = '<span class="done-check">&#10003;</span><ul class="done-bullets">';
      bulletLines.forEach(function(line) {
        listHtml += '<li>' + esc(line.trim().slice(2)) + '</li>';
      });
      listHtml += '</ul>';
      summaryEl.innerHTML = listHtml;
    } else {
      summaryEl.innerHTML = '<span class="done-check">&#10003;</span>' + esc(summary);
    }
    agentLogSteps.appendChild(summaryEl);

    // Show contextual action cards on successful completion (not during replay)
    if (type === "done" && !isReplaying) {
      var cards = document.createElement("div");
      cards.className = "agent-action-cards";
      var actions = [
        { label: "Summarize", action: "chat", text: "Summarize" },
        { label: "Ask a question", action: "focus" },
        { label: "Extract info", action: "chat", text: "Extract the key information from this page as bullet points" }
      ];
      actions.forEach(function(a) {
        var btn = document.createElement("button");
        btn.className = "agent-action-card";
        btn.textContent = a.label;
        btn.addEventListener("click", function() {
          cards.remove();
          if (a.action === "chat") {
            chatSend(a.text);
          } else if (a.action === "focus") {
            goalInput.focus();
            goalInput.placeholder = "Ask anything about this page...";
          }
        });
        cards.appendChild(btn);
      });
      agentLogSteps.appendChild(cards);
    }

    scrollToBottom();
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

  async function chatSend(text) {
    if (!text) return;

    addChatMessage("user", text);
    goalInput.value = "";
    goalInput.style.height = "";

    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs[0];
    var tabId = (tab && tab.id) ? tab.id : null;

    setStatus("thinking", "Thinking...");
    chatTyping.classList.add("visible");

    var result = await sendMsg({ type: "CHAT_SEND", text: text, tabId: tabId });

    chatTyping.classList.remove("visible");

    if (!result || !result.success) {
      addChatMessage("system-info", "Error: " + ((result && result.error) || "Failed to process."));
      setStatus("error", "Chat error");
      return;
    }

    currentMode = "chat";
    modeChip.textContent = "CHAT";
    modeChip.className = "mode-chip chat";
    modeChip.classList.remove("hidden");
    stepChip.classList.add("hidden");

    addChatMessage("assistant", result.content);
    setStatus("idle", "Chat ready");

    // Auto-trigger agent mode if LLM redirects the user there
    if (result.content && result.content.includes("Try using Agent mode")) {
      setTimeout(function() { showTabChoice(text); }, 400);
    }
  }

  /* ═══════════════════════════════════════════
   * Agent Send
   * ═══════════════════════════════════════════ */

  function showTabChoice(text) {
    pendingAgentText = text;
    if (tabChoiceOverlay) tabChoiceOverlay.classList.remove("hidden");
  }

  function hideTabChoice() {
    if (tabChoiceOverlay) tabChoiceOverlay.classList.add("hidden");
    pendingAgentText = "";
  }

  async function agentSend(text, useCurrentTab) {
    if (!text || isRunning) return;

    addChatMessage("user", text);
    goalInput.value = "";
    goalInput.style.height = "";

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
   * Stop Agent
   * ═══════════════════════════════════════════ */

  async function stopAgent() {
    await sendMsg({ type: "STOP_AGENT" });
    isRunning = false;
    updateButtons();
    setStatus("idle", "Stopped by user.");
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

  function toggleWorkflows() {
    workflowDrawer.classList.toggle("open");
    workflowBtn.classList.toggle("active");
    if (workflowDrawer.classList.contains("open")) {
      loadWorkflowList();
      settingsDrawer.classList.remove("open");
      settingsBtn.classList.remove("active");
      personalInfoDrawer.classList.remove("open");
      personalInfoBtn.classList.remove("active");
      researchDrawer.classList.remove("open");
      researchBtn.classList.remove("active");
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
      researchDrawer.classList.remove("open");
      researchBtn.classList.remove("active");
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

  /* ═══════════════════════════════════════════
   * Research Mode
   * ═══════════════════════════════════════════ */

  var researchRunning = false;
  var lastResearchReportId = null;

  function toggleResearch() {
    researchDrawer.classList.toggle("open");
    researchBtn.classList.toggle("active");
    if (researchDrawer.classList.contains("open")) {
      loadResearchReports();
      settingsDrawer.classList.remove("open");
      settingsBtn.classList.remove("active");
      workflowDrawer.classList.remove("open");
      workflowBtn.classList.remove("active");
      personalInfoDrawer.classList.remove("open");
      personalInfoBtn.classList.remove("active");
    }
  }

  async function startResearch() {
    var query = researchQueryInput.value.trim();
    if (!query || researchRunning || isRunning) return;
    researchRunning = true;
    lastResearchReportId = null;
    researchStartBtn.disabled = true;
    researchAbortBtn.classList.add("visible");
    researchViewBtn.classList.remove("visible");
    researchProgress.classList.remove("hidden");
    researchSourceList.innerHTML = "";
    var r = await sendMsg({ type: "RESEARCH_START", query: query });
    if (r && r.error) {
      researchRunning = false;
      researchStartBtn.disabled = false;
      researchAbortBtn.classList.remove("visible");
      addChatMessage("system-info", "Research error: " + r.error);
    }
  }

  async function abortResearch() {
    await sendMsg({ type: "RESEARCH_ABORT" });
  }

  function updateResearchSources(sources) {
    researchSourceList.innerHTML = "";
    sources.forEach(function(src) {
      var row = document.createElement("div");
      row.className = "research-source-row";
      var dot = document.createElement("div");
      dot.className = "research-source-dot";
      if (src.status === "active") dot.classList.add("active");
      else if (src.status === "done") dot.classList.add("done");
      else if (src.status === "error") dot.classList.add("error");
      else if (src.status === "skipped") dot.classList.add("skipped");
      var name = document.createElement("span");
      name.className = "research-source-name";
      name.textContent = src.name;
      var stat = document.createElement("span");
      stat.className = "research-source-status";
      stat.textContent = src.statusText || "";
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(stat);
      researchSourceList.appendChild(row);
    });
  }

  function onResearchDone(reportId) {
    researchRunning = false;
    lastResearchReportId = reportId;
    researchStartBtn.disabled = false;
    researchAbortBtn.classList.remove("visible");
    if (reportId) researchViewBtn.classList.add("visible");
    loadResearchReports();
  }

  function renderResearchReport(report) {
    if (!report) return;
    hideEmpty();

    var msg = document.createElement("div");
    msg.className = "chat-msg assistant";

    var bubble = document.createElement("div");
    bubble.className = "chat-bubble";

    var container = document.createElement("div");
    container.className = "research-report";

    // Title
    var heading = document.createElement("div");
    heading.className = "research-report-heading";
    heading.textContent = "Research: " + (report.query || "Unknown");
    container.appendChild(heading);

    // Source cards
    var sources = report.sources || [];
    sources.forEach(function(src, i) {
      var card = document.createElement("div");
      card.className = "research-source-card";

      var head = document.createElement("div");
      head.className = "research-source-card-head";

      var num = document.createElement("div");
      num.className = "research-source-card-num";
      num.textContent = String(i + 1);

      var title = document.createElement("div");
      title.className = "research-source-card-title";
      if (src.url) {
        var a = document.createElement("a");
        a.href = src.url;
        a.target = "_blank";
        a.textContent = src.title || src.sourceName || src.url;
        title.appendChild(a);
      } else {
        title.textContent = src.title || src.sourceName || "Source " + (i + 1);
      }

      head.appendChild(num);
      head.appendChild(title);
      card.appendChild(head);

      if (src.summary) {
        var summary = document.createElement("div");
        summary.className = "research-source-card-summary";
        summary.innerHTML = renderMarkdown(src.summary);
        card.appendChild(summary);
      }

      if (src.url) {
        var urlLine = document.createElement("div");
        urlLine.className = "research-source-card-url";
        urlLine.textContent = src.url;
        card.appendChild(urlLine);
      }

      container.appendChild(card);
    });

    bubble.appendChild(container);
    msg.appendChild(bubble);
    streamInner.insertBefore(msg, chatTyping);
    scrollToBottom();
  }

  async function viewResearchReport(id) {
    var r = await sendMsg({ type: "RESEARCH_VIEW_REPORT", id: id });
    if (r && r.report) renderResearchReport(r.report);
  }

  async function deleteResearchReport(id) {
    await sendMsg({ type: "RESEARCH_DELETE_REPORT", id: id });
    loadResearchReports();
  }

  async function loadResearchReports() {
    var r = await sendMsg({ type: "RESEARCH_LIST_REPORTS" });
    if (!r || !r.reports || r.reports.length === 0) {
      researchReportsSection.classList.add("hidden");
      return;
    }
    researchReportsSection.classList.remove("hidden");
    researchReportsList.innerHTML = "";
    r.reports.forEach(function(rpt) {
      var item = document.createElement("div");
      item.className = "research-report-item";
      var info = document.createElement("div");
      info.className = "research-report-info";
      var q = document.createElement("div");
      q.className = "research-report-query";
      q.textContent = rpt.query;
      var meta = document.createElement("div");
      meta.className = "research-report-meta";
      meta.textContent = new Date(rpt.createdAt).toLocaleDateString() + " · " + (rpt.sources ? rpt.sources.length : 0) + " sources";
      info.appendChild(q);
      info.appendChild(meta);
      info.addEventListener("click", function() { viewResearchReport(rpt.id); });
      var del = document.createElement("button");
      del.className = "research-report-delete";
      del.title = "Delete";
      del.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
      del.addEventListener("click", function(e) { e.stopPropagation(); deleteResearchReport(rpt.id); });
      item.appendChild(info);
      item.appendChild(del);
      researchReportsList.appendChild(item);
    });
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
      executeReplay(workflowId, tab.id, {});
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

  async function executeReplay(workflowId, tabId, paramValues) {
    addChatMessage("system-info", "Starting workflow replay...");
    workflowDrawer.classList.remove("open");
    workflowBtn.classList.remove("active");

    var result = await sendMsg({ type: "WF_REPLAY", workflowId: workflowId, tabId: tabId, paramValues: paramValues });
    if (!result || !result.success) {
      addChatMessage("system-info", "Replay failed: " + (result && result.error || "Unknown error"));
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
      executeReplay(pendingReplayWorkflowId, pendingReplayTabId, vals);
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
      researchDrawer.classList.remove("open");
      researchBtn.classList.remove("active");
    }
  }

  async function saveSettings() {
    var providers = readProviderFields();
    var config = {
      provider: selectedProvider,
      providers: providers,
      maxSteps: parseInt(cfgMaxSteps.value, 10) || 20,
      interStepDelay: parseInt(cfgDelay.value, 10) || 2000,
      llmTimeout: parseInt(cfgTimeout.value, 10) || 15000,
      wallTimeout: (parseInt(cfgWallTimeout.value, 10) || 300) * 1000
    };
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
      cfgTimeout.value  = cfg.llmTimeout || 15000;
      cfgWallTimeout.value = Math.round((cfg.wallTimeout || 300000) / 1000);
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

    // Workflow replay progress
    if (msg.type === "REPLAY_STATUS") {
      if (msg.replaying) {
        setStatus("active", "Replaying step " + msg.step + "/" + msg.total);
        if (msg.description) {
          addChatMessage("system-info", "Step " + msg.step + ": " + msg.description);
        }
      } else {
        setStatus("idle", "Replay complete");
        addChatMessage("system-info", "Workflow replay finished.");
        replayPausedBar.classList.add("hidden");
      }
    }

    // Replay paused (login wall, etc.)
    if (msg.type === "REPLAY_PAUSED") {
      pauseLabel.textContent = msg.reason || "Paused";
      replayPausedBar.classList.remove("hidden");
    }

    // Research mode broadcasts
    if (msg.type === "RESEARCH_PROGRESS") {
      updateResearchSources(msg.sources || []);
    }
    if (msg.type === "RESEARCH_STATUS") {
      if (msg.status === "done" || msg.status === "error" || msg.status === "aborted") {
        onResearchDone(msg.reportId || null);
        if (msg.status === "error") {
          addChatMessage("system-info", "Research error: " + (msg.message || "Unknown error"));
        } else if (msg.status === "done" && msg.report) {
          renderResearchReport(msg.report);
        } else if (msg.status === "aborted" && msg.report) {
          addChatMessage("system-info", "Research aborted. Partial results:");
          renderResearchReport(msg.report);
        } else if (msg.status === "aborted") {
          addChatMessage("system-info", "Research aborted.");
        }
      }
    }

  });

  /* ═══════════════════════════════════════════
   * Event Bindings
   * ═══════════════════════════════════════════ */

  chatBtn.addEventListener("click", function() {
    if (isRunning) return;
    var text = goalInput.value.trim();
    if (text) chatSend(text);
  });

  agentBtn.addEventListener("click", function() {
    if (isRunning) return;
    var text = goalInput.value.trim();
    if (text) showTabChoice(text);
  });

  stopBtn.addEventListener("click", stopAgent);

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

  // Personal Info
  personalInfoBtn.addEventListener("click", togglePersonalInfo);
  document.getElementById("closePersonalInfoBtn").addEventListener("click", togglePersonalInfo);
  document.getElementById("cancelPersonalInfoBtn").addEventListener("click", togglePersonalInfo);
  document.getElementById("savePersonalInfoBtn").addEventListener("click", savePersonalInfo);

  // Research Mode
  researchBtn.addEventListener("click", toggleResearch);
  document.getElementById("closeResearchBtn").addEventListener("click", toggleResearch);
  researchStartBtn.addEventListener("click", startResearch);
  researchAbortBtn.addEventListener("click", abortResearch);
  researchViewBtn.addEventListener("click", function() {
    if (lastResearchReportId) viewResearchReport(lastResearchReportId);
  });
  researchQueryInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); startResearch(); }
  });


  // Keyboard: Enter = chat, Ctrl+Enter = agent
  goalInput.addEventListener("keydown", function(e) {
    if (isRunning) return;
    var text = goalInput.value.trim();
    if (!text) return;

    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      chatSend(text);
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      showTabChoice(text);
    }
  });

  goalInput.addEventListener("input", function() {
    goalInput.style.height = "auto";
    goalInput.style.height = Math.min(goalInput.scrollHeight, 88) + "px";
  });

  goalInput.addEventListener("focus", stopPlaceholderRotation);
  goalInput.addEventListener("blur", function() {
    if (!isRunning) startPlaceholderRotation();
  });

  // Tab choice popover bindings
  if (tabChoiceThis) {
    tabChoiceThis.addEventListener("click", function() {
      var text = pendingAgentText;
      hideTabChoice();
      if (text) agentSend(text, true);
    });
  }
  if (tabChoiceNew) {
    tabChoiceNew.addEventListener("click", function() {
      var text = pendingAgentText;
      hideTabChoice();
      if (text) agentSend(text, false);
    });
  }
  if (tabChoiceOverlay) {
    tabChoiceOverlay.addEventListener("click", function(e) {
      if (e.target === tabChoiceOverlay) hideTabChoice();
    });
  }

  /* ── Boot ── */
  init();
})();
