/**
 * Content Script — WebWright Extension v2
 * Runs in the context of every web page.
 *
 * CAPTURE STRATEGY (aggressive):
 *   - ALL anchor, button, input, textarea, select elements
 *   - ANY element with cursor:pointer (regardless of tag name)
 *   - ANY element with role= interactive ARIA roles
 *   - ANY element with tabindex >= 0
 *   - ANY element with onclick attribute
 *   - ANY element with href attribute (custom components)
 *   - ANY contenteditable element
 *   - Custom web components with clickable behavior (YouTube's ytd-*, etc.)
 *   - Elements inside shadow DOMs (flattened)
 *   - Deduplication: skip child if ancestor is already captured AND child has no unique action
 *   - Smart cap: prioritize viewport elements, then off-screen, up to configurable limit
 *
 * v2 Changes:
 *   - Fixed type action to use nativeInputValueSetter for React-controlled inputs
 *   - Added CAPTURE_SUMMARY for chat mode (full page text extraction)
 */

(() => {
  "use strict";

  const AGENT_ATTR = "data-agent-id";
  let nextAgentId = 0;

  /* ───────────────────────────────────────────
   * Element classification
   * ─────────────────────────────────────────── */

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "META", "HEAD", "LINK",
    "BR", "HR", "TEMPLATE", "IFRAME"
  ]);

  const ALWAYS_INTERACTIVE = new Set([
    "A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "OPTION",
    "DETAILS", "SUMMARY", "VIDEO", "AUDIO"
  ]);

  const INTERACTIVE_ROLES = new Set([
    "button", "link", "menuitem", "menuitemcheckbox", "menuitemradio",
    "tab", "checkbox", "radio", "textbox", "combobox", "searchbox",
    "option", "switch", "slider", "spinbutton", "listbox", "treeitem",
    "gridcell", "row", "columnheader", "rowheader", "tooltip",
    "progressbar", "scrollbar", "separator", "dialog", "alertdialog",
    "navigation", "tabpanel", "menu", "toolbar"
  ]);

  const MAX_ELEMENTS = 300;

  /* ───────────────────────────────────────────
   * Visibility checks
   * ─────────────────────────────────────────── */

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none") return false;
      if (style.visibility === "hidden") return false;
      // opacity:0 elements are allowed through — tagged as hidden separately
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 && rect.height <= 1) return false;
      return true;
    } catch {
      return false;
    }
  }

  function isHiddenByOpacity(el) {
    try {
      return parseFloat(window.getComputedStyle(el).opacity) === 0;
    } catch {
      return false;
    }
  }

  function isInViewport(el) {
    try {
      const rect = el.getBoundingClientRect();
      return (
        rect.top < window.innerHeight + 100 &&
        rect.bottom > -100 &&
        rect.left < window.innerWidth + 100 &&
        rect.right > -100
      );
    } catch {
      return false;
    }
  }

  /* ───────────────────────────────────────────
   * Interactivity detection (aggressive)
   * ─────────────────────────────────────────── */

  function isInteractive(el) {
    const tag = el.tagName;
    if (ALWAYS_INTERACTIVE.has(tag)) return true;
    const role = el.getAttribute("role");
    if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;
    if (el.isContentEditable) return true;
    if (el.hasAttribute("tabindex") && el.tabIndex >= 0) return true;
    if (el.hasAttribute("onclick") || el.hasAttribute("onmousedown") ||
        el.hasAttribute("onmouseup") || el.hasAttribute("ontouchstart") ||
        el.hasAttribute("onkeydown") || el.hasAttribute("onkeyup")) {
      return true;
    }
    if (el.hasAttribute("href")) return true;
    if (el.hasAttribute("data-url") || el.hasAttribute("data-href") ||
        el.hasAttribute("data-action") || el.hasAttribute("data-click") ||
        el.hasAttribute("data-target") || el.hasAttribute("data-toggle") ||
        el.hasAttribute("data-link")) {
      return true;
    }
    try {
      const style = window.getComputedStyle(el);
      if (style.cursor === "pointer") return true;
    } catch {}
    if (tag.includes("-")) {
      if (el.hasAttribute("aria-label") || el.hasAttribute("aria-haspopup") ||
          el.hasAttribute("aria-expanded") || el.hasAttribute("aria-pressed") ||
          el.hasAttribute("aria-selected") || el.hasAttribute("aria-checked")) {
        return true;
      }
    }
    return false;
  }

  /* ───────────────────────────────────────────
   * Text extraction
   * ─────────────────────────────────────────── */

  function getVisibleText(el) {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim().slice(0, 150);
    let text = "";
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      text = el.value || el.placeholder || "";
    } else if (tag === "SELECT") {
      const selected = el.options[el.selectedIndex];
      text = selected ? selected.text : "";
    } else if (tag === "IMG") {
      text = el.alt || el.title || "";
    } else {
      text = (el.innerText || el.textContent || "").trim();
    }
    text = text.replace(/\s+/g, " ").trim().slice(0, 150);
    if (!text) {
      text = (
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        el.getAttribute("alt") ||
        el.getAttribute("value") ||
        el.getAttribute("data-tooltip") ||
        ""
      ).trim().slice(0, 150);
    }
    return text;
  }

  /* ───────────────────────────────────────────
   * Agent ID management
   * ─────────────────────────────────────────── */

  function assignAgentId(el) {
    if (!el.getAttribute(AGENT_ATTR)) {
      el.setAttribute(AGENT_ATTR, String(nextAgentId++));
    }
    return el.getAttribute(AGENT_ATTR);
  }

  function selectorFor(el) {
    return `[${AGENT_ATTR}="${el.getAttribute(AGENT_ATTR)}"]`;
  }

  /* ───────────────────────────────────────────
   * Deduplication
   * ─────────────────────────────────────────── */

  function hasInteractiveAncestor(el, capturedSet) {
    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 5) {
      if (capturedSet.has(parent)) {
        const pTag = parent.tagName;
        if (pTag === "A" || pTag === "BUTTON" ||
            parent.getAttribute("role") === "button" ||
            parent.getAttribute("role") === "link") {
          return true;
        }
      }
      parent = parent.parentElement;
      depth++;
    }
    return false;
  }

  /* ───────────────────────────────────────────
   * Shadow DOM traversal
   * ─────────────────────────────────────────── */

  function walkElement(root, callback) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let node = walker.nextNode();
    while (node) {
      callback(node);
      if (node.shadowRoot) {
        walkElement(node.shadowRoot, callback);
      }
      node = walker.nextNode();
    }
  }

  /* ───────────────────────────────────────────
   * Element info extraction
   * ─────────────────────────────────────────── */

  function extractElementInfo(el) {
    const text = getVisibleText(el);
    const tag = el.tagName.toLowerCase();
    const agentId = assignAgentId(el);
    const selector = selectorFor(el);
    const rect = el.getBoundingClientRect();

    const info = {
      id: parseInt(agentId, 10),
      tag,
      selector,
      text: text || "",
      inViewport: isInViewport(el)
    };

    if (el.type) info.type = el.type;
    if (el.href) info.href = el.href;
    if (el.name) info.name = el.name;
    if (el.getAttribute("aria-label")) info.ariaLabel = el.getAttribute("aria-label");
    if (el.placeholder) info.placeholder = el.placeholder;
    if (el.getAttribute("role")) info.role = el.getAttribute("role");
    if (el.getAttribute("data-url")) info.dataUrl = el.getAttribute("data-url");
    if (el.getAttribute("data-href")) info.dataHref = el.getAttribute("data-href");
    if (el.disabled) info.disabled = true;
    if (el.readOnly) info.readOnly = true;
    if (el._agentHidden) info.hidden = true;
    if (el.id) info.htmlId = el.id;

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      info.value = el.value || "";
    }
    if (el.tagName === "SELECT") {
      const allOpts = Array.from(el.options);
      info.options = allOpts.slice(0, 50).map(o => ({
        value: o.value,
        text: o.text,
        selected: o.selected
      }));
      if (allOpts.length > 50) info.optionsTruncated = allOpts.length;
    }

    info.bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height)
    };

    return info;
  }

  /* ───────────────────────────────────────────
   * Main Capture — Page State
   * ─────────────────────────────────────────── */

  function capturePageState(capOverride) {
    const cap = capOverride || MAX_ELEMENTS;
    nextAgentId = 0;
    document.querySelectorAll(`[${AGENT_ATTR}]`).forEach(el => el.removeAttribute(AGENT_ATTR));

    const viewportElements = [];
    const offscreenElements = [];
    const capturedSet = new WeakSet();

    walkElement(document.body, (node) => {
      if (viewportElements.length + offscreenElements.length >= cap * 2) return;
      if (!isInteractive(node)) return;
      if (!isVisible(node)) return;

      // Flag hover-hidden elements (opacity: 0) for tagging
      node._agentHidden = isHiddenByOpacity(node);

      const text = getVisibleText(node);
      if (!text && node.tagName !== "INPUT" && node.tagName !== "TEXTAREA" &&
          node.tagName !== "SELECT" && node.tagName !== "VIDEO" && node.tagName !== "AUDIO") {
        const rect = node.getBoundingClientRect();
        if (rect.width < 20 && rect.height < 20) return;
      }

      if (hasInteractiveAncestor(node, capturedSet)) return;
      capturedSet.add(node);

      if (isInViewport(node)) {
        viewportElements.push(node);
      } else {
        offscreenElements.push(node);
      }
    });

    const selected = [];
    const budget = cap;

    for (const el of viewportElements) {
      if (selected.length >= budget) break;
      selected.push(extractElementInfo(el));
    }
    const remaining = budget - selected.length;
    for (let i = 0; i < Math.min(remaining, offscreenElements.length); i++) {
      selected.push(extractElementInfo(offscreenElements[i]));
    }

    return {
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
      scrollY: Math.round(window.scrollY),
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      totalCaptured: viewportElements.length + offscreenElements.length,
      inViewport: viewportElements.length,
      elements: selected
    };
  }

  /* ───────────────────────────────────────────
   * Page Summary Capture (for Chat mode)
   * Extracts readable text content from the page
   * ─────────────────────────────────────────── */

  function capturePageSummary() {
    const SKIP_SUMMARY = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "META", "HEAD", "LINK", "SVG", "IFRAME", "TEMPLATE"]);

    function extractText(node, depth) {
      if (depth > 20) return "";
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        return t.length > 0 ? t : "";
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (SKIP_SUMMARY.has(node.tagName)) return "";
      try {
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return "";
        // Skip cookie/consent/GDPR overlays (fixed/sticky positioned with high z-index)
        const nid = (node.id || "").toLowerCase();
        const ncls = (typeof node.className === "string" ? node.className : "").toLowerCase();
        const nrole = (node.getAttribute("role") || "").toLowerCase();
        if (nid.includes("cookie") || nid.includes("consent") || nid.includes("gdpr") ||
            ncls.includes("cookie") || ncls.includes("consent") || ncls.includes("gdpr") ||
            nrole === "dialog" || nrole === "alertdialog") {
          if (style.position === "fixed" || style.position === "sticky" || parseInt(style.zIndex) > 999) {
            return "";
          }
        }
      } catch {}

      const parts = [];
      const tag = node.tagName;

      // Add structural markers
      if (tag === "H1" || tag === "H2" || tag === "H3" || tag === "H4" || tag === "H5" || tag === "H6") {
        const inner = node.innerText || "";
        if (inner.trim()) parts.push("\n## " + inner.trim() + "\n");
        return parts.join("");
      }
      if (tag === "LI") {
        const inner = node.innerText || "";
        if (inner.trim()) parts.push("• " + inner.trim().slice(0, 300));
        return parts.join("");
      }
      if (tag === "P" || tag === "BLOCKQUOTE" || tag === "ARTICLE" || tag === "SECTION") {
        const inner = node.innerText || "";
        if (inner.trim()) parts.push(inner.trim().slice(0, 1000) + "\n");
        return parts.join("");
      }

      for (const child of node.childNodes) {
        const t = extractText(child, depth + 1);
        if (t) parts.push(t);
      }
      return parts.join(" ");
    }

    let text = extractText(document.body, 0);
    // Collapse whitespace
    text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    // Cap at ~8000 chars for LLM context
    if (text.length > 8000) text = text.slice(0, 8000) + "\n\n[…content truncated]";

    // Detect if content is dominated by overlay/cookie language
    const overlayPatterns = [
      "accept all cookies", "cookie preferences", "cookie consent",
      "we use cookies", "manage cookies", "reject all",
      "accept and continue", "cookie policy", "privacy preferences",
      "by continuing", "this website uses cookies"
    ];
    const first500 = text.toLowerCase().slice(0, 500);
    const overlayDetected = overlayPatterns.filter(p => first500.includes(p)).length >= 2;

    return {
      url: window.location.href,
      title: document.title,
      text: text,
      readyState: document.readyState,
      scrollY: Math.round(window.scrollY),
      documentHeight: document.documentElement.scrollHeight,
      overlayDetected: overlayDetected
    };
  }

  /* ───────────────────────────────────────────
   * Native Input Value Setter (React-compatible)
   * ─────────────────────────────────────────── */

  function setNativeValue(el, value) {
    const tag = el.tagName;
    let setter = null;
    if (tag === "INPUT") {
      setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    } else if (tag === "TEXTAREA") {
      setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    }
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    // Dispatch React-compatible events
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /* ───────────────────────────────────────────
   * Action Executor (v2 — uses nativeInputValueSetter)
   * ─────────────────────────────────────────── */

  // Snapshot an element's visible state (text, attributes) for before/after comparison.
  function snapshotElement(el) {
    if (!el) return null;
    const text = (el.innerText || el.textContent || "").trim().slice(0, 120);
    const ariaLabel = el.getAttribute("aria-label") || "";
    const disabled = el.disabled || false;
    const ariaPressed = el.getAttribute("aria-pressed") || "";
    const ariaExpanded = el.getAttribute("aria-expanded") || "";
    const className = (el.className && typeof el.className === "string") ? el.className.slice(0, 80) : "";
    const snap = {};
    if (text) snap.text = text;
    if (ariaLabel) snap.ariaLabel = ariaLabel;
    if (disabled) snap.disabled = true;
    if (ariaPressed) snap.ariaPressed = ariaPressed;
    if (ariaExpanded) snap.ariaExpanded = ariaExpanded;
    if (className) snap.class = className;
    if (el.value != null && el.value !== "") snap.value = String(el.value).slice(0, 120);
    return snap;
  }

  // Build a concise stateAfter diff: only include fields that changed.
  function diffSnapshots(before, after) {
    if (!before || !after) return after || null;
    const diff = {};
    let changed = false;
    for (const key of Object.keys(after)) {
      if (after[key] !== before[key]) { diff[key] = after[key]; changed = true; }
    }
    for (const key of Object.keys(before)) {
      if (!(key in after)) { diff[key] = null; changed = true; }
    }
    return changed ? diff : null;
  }

  function isElementInViewport(el) {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
  }

  // Resolve an element by selector, falling back to attribute-based matching
  // when the data-agent-id attribute is stale (DOM re-rendered by React/SPA).
  function resolveElement(selector, hints) {
    // 1. Try the original selector
    const el = document.querySelector(selector);
    if (el) return el;
    if (!hints) return null;

    const tag = (hints.tag || "").toUpperCase();
    const candidates = tag
      ? Array.from(document.querySelectorAll(tag))
      : Array.from(document.querySelectorAll("a,button,input,textarea,select,[role],[tabindex],[onclick]"));

    let bestEl = null;
    let bestScore = 0;

    for (const c of candidates) {
      let score = 0;

      // HTML id match
      if (hints.htmlId && c.id === hints.htmlId) return c; // exact, instant

      // Name attribute
      if (hints.name && c.name === hints.name) score += 30;

      // Exact text match
      const cText = getVisibleText(c);
      if (hints.text && cText) {
        if (cText === hints.text) score += 40;
        else if (cText.toLowerCase() === hints.text.toLowerCase()) score += 35;
        else if (cText.includes(hints.text) || hints.text.includes(cText)) score += 15;
      }

      // AriaLabel
      const cAria = c.getAttribute("aria-label") || "";
      if (hints.ariaLabel && cAria) {
        if (cAria === hints.ariaLabel) score += 35;
        else if (cAria.toLowerCase() === hints.ariaLabel.toLowerCase()) score += 30;
      }

      // Placeholder
      if (hints.placeholder && c.placeholder === hints.placeholder) score += 30;

      // Role
      if (hints.role && c.getAttribute("role") === hints.role) score += 8;

      // Type
      if (hints.type && c.type === hints.type) score += 8;

      // Href
      if (hints.href && c.href === hints.href) score += 25;

      if (score > bestScore) {
        bestScore = score;
        bestEl = c;
      }
    }

    // Require minimum confidence to avoid clicking wrong element
    return bestScore >= 25 ? bestEl : null;
  }

  async function executeAction(action) {
    try {
      switch (action.action) {

        case "navigate": {
          window.location.href = action.url;
          return { success: true, action: "navigate", url: action.url };
        }

        case "click": {
          const el = resolveElement(action.selector, action._hints);
          if (!el) {
            return { success: false, action: "click", error: `Element not found: ${action.selector}` };
          }
          // Video/Audio special handling — toggle play/pause directly
          const mediaEl = el.tagName === "VIDEO" ? el
                        : el.tagName === "AUDIO" ? el
                        : el.querySelector("video") || el.querySelector("audio");
          if (mediaEl && (mediaEl.tagName === "VIDEO" || mediaEl.tagName === "AUDIO")) {
            try {
              if (mediaEl.paused) mediaEl.play();
              else mediaEl.pause();
            } catch {}
            return {
              success: true, action: "click", selector: action.selector,
              clickedTag: mediaEl.tagName.toLowerCase(),
              clickedText: mediaEl.paused ? "paused" : "playing",
              effectObserved: true,
              description: action.description || ""
            };
          }
          const before = snapshotElement(el);
          const urlBefore = window.location.href;
          if (!isElementInViewport(el)) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            await sleep(200);
          }
          el.focus();
          const opts = { bubbles: true, cancelable: true, view: window };
          el.dispatchEvent(new PointerEvent("pointerdown", opts));
          el.dispatchEvent(new MouseEvent("mousedown", opts));
          el.dispatchEvent(new PointerEvent("pointerup", opts));
          el.dispatchEvent(new MouseEvent("mouseup", opts));
          el.dispatchEvent(new MouseEvent("click", opts));
          try { el.click(); } catch {}
          // Ensure checkbox/radio state change events fire
          if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
          // Brief wait for the page to react (state change, re-render)
          await sleep(100);
          // If element has aria-expanded and it didn't toggle, try keyboard activation
          if (el.hasAttribute && el.hasAttribute("aria-expanded")) {
            const expandedNow = el.getAttribute("aria-expanded");
            if (before && expandedNow === before.ariaExpanded) {
              el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
              await sleep(200);
            }
          }
          const after = snapshotElement(el);
          const stateAfter = diffSnapshots(before, after);
          const urlAfterClick = window.location.href;
          const urlChanged = urlAfterClick !== urlBefore;
          const res = { success: true, action: "click", selector: action.selector, description: action.description || "" };
          if (stateAfter) res.stateAfter = stateAfter;
          if (urlChanged) res.urlChanged = urlAfterClick;
          res.effectObserved = !!(stateAfter || urlChanged);
          return res;
        }

        case "type": {
          const el = resolveElement(action.selector, action._hints);
          if (!el) {
            return { success: false, action: "type", error: `Element not found: ${action.selector}` };
          }
          const before = snapshotElement(el);
          if (!isElementInViewport(el)) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            await sleep(50);
          }
          el.focus();
          await sleep(50);

          if (el.isContentEditable) {
            // contenteditable (e.g. YouTube comment box) — use execCommand so the
            // page's own input watchers fire correctly and Post/Comment buttons unlock.
            document.execCommand("selectAll", false, null);
            document.execCommand("delete", false, null);
            await sleep(50);
            document.execCommand("insertText", false, action.value);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            // Try batch set first (fast path)
            setNativeValue(el, action.value);
            await sleep(30);
            // If React reset the value, fall back to char-by-char
            if (el.value !== action.value) {
              setNativeValue(el, "");
              let currentValue = "";
              for (const char of action.value) {
                currentValue += char;
                setNativeValue(el, currentValue);
                await sleep(20);
              }
            }
          }

          if (action.then_submit) {
            await sleep(100);
            if (el.form) {
              el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
            } else {
              const enterOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
              el.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
              el.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
              el.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
            }
          }
          await sleep(100);
          const after = snapshotElement(el);
          const stateAfter = diffSnapshots(before, after);
          const res = { success: true, action: "type", selector: action.selector, value: action.value };
          if (stateAfter) res.stateAfter = stateAfter;
          return res;
        }

        case "select": {
          const el = resolveElement(action.selector, action._hints);
          if (!el) return { success: false, action: "select", error: `Element not found: ${action.selector}` };
          if (el.tagName !== "SELECT") {
            // Custom dropdown — try clicking to open, then user clicks option next step
            if (!isElementInViewport(el)) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              await sleep(200);
            }
            el.focus();
            el.click();
            await sleep(300);
            return { success: true, action: "select", selector: action.selector, note: "Not a native select — clicked to open. Use click on the desired option next." };
          }
          const val = action.value;
          let found = false;
          for (const opt of el.options) {
            if (opt.value === val || opt.text === val || opt.text.toLowerCase().includes(val.toLowerCase())) {
              el.value = opt.value;
              found = true;
              break;
            }
          }
          if (!found) return { success: false, action: "select", error: `Option "${val}" not found in select` };
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return { success: true, action: "select", selector: action.selector, value: val };
        }

        case "key": {
          const target = action.selector ? resolveElement(action.selector, action._hints) : document.activeElement;
          if (!target) return { success: false, action: "key", error: "No target element for key press" };
          if (action.selector) {
            if (!isElementInViewport(target)) {
              target.scrollIntoView({ behavior: "smooth", block: "center" });
              await sleep(100);
            }
            target.focus();
          }
          const kOpts = { key: action.key, code: action.key, bubbles: true, cancelable: true };
          target.dispatchEvent(new KeyboardEvent("keydown", kOpts));
          target.dispatchEvent(new KeyboardEvent("keypress", kOpts));
          target.dispatchEvent(new KeyboardEvent("keyup", kOpts));
          return { success: true, action: "key", key: action.key };
        }

        case "hover": {
          const el = resolveElement(action.selector, action._hints);
          if (!el) return { success: false, action: "hover", error: `Element not found: ${action.selector}` };
          if (!isElementInViewport(el)) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            await sleep(200);
          }
          el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
          return { success: true, action: "hover", selector: action.selector };
        }

        case "scroll": {
          const amount = action.amount || 500;
          const direction = action.direction === "up" ? -1 : 1;
          window.scrollBy({ top: direction * amount, behavior: "smooth" });
          return { success: true, action: "scroll", direction: action.direction, amount };
        }

        case "wait": {
          const ms = Math.min(action.ms || 1500, 10000);
          await sleep(ms);
          return { success: true, action: "wait", ms, reason: action.reason || "" };
        }

        case "done": {
          return { success: true, action: "done", summary: action.summary || "Goal completed." };
        }

        case "error": {
          return { success: false, action: "error", reason: action.reason || "Unknown error." };
        }

        default: {
          return { success: false, action: action.action, error: `Unknown action type: ${action.action}` };
        }
      }
    } catch (err) {
      return { success: false, action: action.action, error: err.message };
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /* ───────────────────────────────────────────
   * Vision Mode — Execute action at pixel coordinates
   * ─────────────────────────────────────────── */

  async function executeVisionAction(action) {
    try {
      switch (action.action) {

        case "click": {
          const x = Math.round(action.x);
          const y = Math.round(action.y);
          if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) {
            return { success: false, action: "click", error: `Coordinates (${x}, ${y}) out of viewport (${window.innerWidth}x${window.innerHeight})` };
          }
          // Use shadow-DOM-aware + overlay-skipping element finder
          const el = interactiveElementFromPoint(x, y);
          if (!el) {
            return { success: false, action: "click", error: `No element found at (${x}, ${y})` };
          }
          const clickTarget = findClickableAncestor(el) || el;

          // For VIDEO elements, use .click() or toggle play directly
          if (clickTarget.tagName === "VIDEO") {
            try {
              if (clickTarget.paused) clickTarget.play();
              else clickTarget.pause();
            } catch {}
            return {
              success: true, action: "click", x, y,
              clickedTag: "video",
              clickedText: clickTarget.paused ? "paused" : "playing",
              description: action.description || ""
            };
          }

          clickTarget.scrollIntoView({ behavior: "instant", block: "nearest" });
          await sleep(100);
          const screenX = x + window.screenX;
          const screenY = y + window.screenY;
          const opts = {
            bubbles: true, cancelable: true, composed: true, view: window,
            clientX: x, clientY: y, screenX, screenY,
            button: 0, buttons: 1, pointerId: 1, pointerType: "mouse"
          };
          clickTarget.dispatchEvent(new PointerEvent("pointerdown", opts));
          clickTarget.dispatchEvent(new MouseEvent("mousedown", opts));
          clickTarget.dispatchEvent(new PointerEvent("pointerup", opts));
          clickTarget.dispatchEvent(new MouseEvent("mouseup", opts));
          clickTarget.dispatchEvent(new MouseEvent("click", opts));
          try { clickTarget.click(); } catch {}
          return {
            success: true, action: "click", x, y,
            clickedTag: clickTarget.tagName.toLowerCase(),
            clickedText: getVisibleText(clickTarget).slice(0, 80),
            description: action.description || ""
          };
        }

        case "type": {
          const x = Math.round(action.x);
          const y = Math.round(action.y);
          if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) {
            return { success: false, action: "type", error: `Coordinates (${x}, ${y}) out of viewport` };
          }
          let el = interactiveElementFromPoint(x, y);
          if (!el) {
            return { success: false, action: "type", error: `No element found at (${x}, ${y})` };
          }
          const inputTarget = findInputAncestor(el) || el;
          const clickOpts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
          inputTarget.dispatchEvent(new MouseEvent("click", clickOpts));
          await sleep(150);
          inputTarget.focus();
          await sleep(100);
          if (inputTarget.tagName === "INPUT" || inputTarget.tagName === "TEXTAREA") {
            setNativeValue(inputTarget, action.value);
            await sleep(30);
            if (inputTarget.value !== action.value) {
              setNativeValue(inputTarget, "");
              let currentValue = "";
              for (const char of action.value) {
                currentValue += char;
                setNativeValue(inputTarget, currentValue);
                await sleep(20);
              }
            }
          } else if (inputTarget.isContentEditable) {
            document.execCommand("selectAll", false, null);
            document.execCommand("delete", false, null);
            await sleep(50);
            document.execCommand("insertText", false, action.value);
            inputTarget.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            setNativeValue(inputTarget, action.value);
            await sleep(30);
            if (inputTarget.value !== action.value) {
              setNativeValue(inputTarget, "");
              let currentValue = "";
              for (const char of action.value) {
                currentValue += char;
                setNativeValue(inputTarget, currentValue);
                await sleep(20);
              }
            }
          }
          if (action.then_submit) {
            await sleep(200);
            if (inputTarget.form) {
              inputTarget.form.requestSubmit ? inputTarget.form.requestSubmit() : inputTarget.form.submit();
            } else {
              const enterOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
              inputTarget.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
              inputTarget.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
              inputTarget.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
            }
          }
          return {
            success: true, action: "type", x, y,
            value: action.value,
            typedInto: inputTarget.tagName.toLowerCase(),
            description: action.description || ""
          };
        }

        case "key": {
          const x = action.x != null ? Math.round(action.x) : null;
          const y = action.y != null ? Math.round(action.y) : null;
          const el = (x != null && y != null) ? interactiveElementFromPoint(x, y) : document.activeElement;
          const target = el || document.activeElement;
          if (x != null && y != null && el) el.focus();
          const kOpts = { key: action.key, code: action.key, bubbles: true, cancelable: true };
          target.dispatchEvent(new KeyboardEvent("keydown", kOpts));
          target.dispatchEvent(new KeyboardEvent("keypress", kOpts));
          target.dispatchEvent(new KeyboardEvent("keyup", kOpts));
          return { success: true, action: "key", key: action.key };
        }

        case "hover": {
          const x = Math.round(action.x);
          const y = Math.round(action.y);
          const el = interactiveElementFromPoint(x, y);
          if (!el) return { success: false, action: "hover", error: `No element at (${x}, ${y})` };
          el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
          el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: x, clientY: y }));
          el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, clientX: x, clientY: y }));
          return { success: true, action: "hover", x, y };
        }

        default:
          return { success: false, error: `Vision action '${action.action}' not supported` };
      }
    } catch (err) {
      return { success: false, action: action.action, error: err.message };
    }
  }

  // Penetrate shadow DOM to find the deepest element at (x, y)
  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    if (!el) return null;
    // Drill through shadow roots
    while (el && el.shadowRoot) {
      const deeper = el.shadowRoot.elementFromPoint(x, y);
      if (!deeper || deeper === el) break;
      el = deeper;
    }
    return el;
  }

  // Skip invisible overlays — find the real interactive element at (x, y)
  function interactiveElementFromPoint(x, y) {
    const candidates = document.elementsFromPoint(x, y);
    for (const el of candidates) {
      // Drill into shadow roots
      let target = el;
      while (target && target.shadowRoot) {
        const deeper = target.shadowRoot.elementFromPoint(x, y);
        if (!deeper || deeper === target) break;
        target = deeper;
      }
      // Skip invisible or non-interactive overlays
      const style = window.getComputedStyle(target);
      if (style.pointerEvents === "none") continue;
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (parseFloat(style.opacity) === 0) continue;
      // Found a real visible element
      return target;
    }
    // Fallback to deepElementFromPoint
    return deepElementFromPoint(x, y);
  }

  function findClickableAncestor(el) {
    let current = el;
    // Search up to 10 levels, crossing shadow DOM boundaries
    for (let d = 0; current && d < 10; d++) {
      const tag = current.tagName;
      if (tag === "A" || tag === "BUTTON" || tag === "VIDEO") return current;
      const role = current.getAttribute && current.getAttribute("role");
      if (role === "button" || role === "link" || role === "menuitem" || role === "tab") return current;
      if (current.hasAttribute && (current.hasAttribute("onclick") || current.hasAttribute("data-url") || current.hasAttribute("href"))) return current;
      if (tag && tag.includes("-") && current.hasAttribute && (current.hasAttribute("aria-label") || current.hasAttribute("tabindex"))) return current;
      // Cross shadow DOM boundary
      current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
    }
    return null;
  }

  function findInputAncestor(el) {
    let current = el;
    for (let d = 0; current && d < 4; d++, current = current.parentElement) {
      if (current.tagName === "INPUT" || current.tagName === "TEXTAREA") return current;
      if (current.isContentEditable) return current;
      const role = current.getAttribute("role");
      if (role === "textbox" || role === "searchbox") return current;
    }
    const inputs = el.querySelectorAll ? el.querySelectorAll("input, textarea, [contenteditable='true']") : [];
    return inputs.length > 0 ? inputs[0] : null;
  }

  /* ───────────────────────────────────────────
   * Page stability
   * ─────────────────────────────────────────── */

  function waitForPageStable(timeout = 5000, minWait = 500) {
    return new Promise(resolve => {
      if (document.readyState === "complete") {
        setTimeout(resolve, minWait);
        return;
      }
      const timer = setTimeout(resolve, timeout);
      window.addEventListener("load", () => {
        clearTimeout(timer);
        setTimeout(resolve, minWait);
      }, { once: true });
    });
  }

  // Adaptive wait: resolves once DOM mutations stop for `quiet` ms, or after `maxWait` ms.
  // Filters out animation-only mutations so animated pages settle faster.
  function waitForDOMSettle(quiet, maxWait) {
    quiet = quiet || 300;
    maxWait = maxWait || 3000;
    return new Promise(resolve => {
      let timer = null;
      const t0 = Date.now();
      const maxTimer = setTimeout(done, maxWait);

      const observer = new MutationObserver((mutations) => {
        // Only reset timer for structural mutations, not animation noise
        const hasStructural = mutations.some(m => {
          // Node additions/removals are always structural
          if (m.type === "childList" && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) return true;
          // Attribute changes: skip if element has active animation/transition
          if (m.type === "attributes") {
            const el = m.target;
            if (!el || !el.style) return true;
            try {
              const style = window.getComputedStyle(el);
              if (style.animation && style.animation !== "none") return false;
              if (style.transition && style.transition !== "none" && style.transition !== "all 0s ease 0s") return false;
              if (style.willChange && style.willChange !== "auto") return false;
            } catch {}
            // Skip style/class changes on known animation patterns
            if (m.attributeName === "style" || m.attributeName === "class") {
              const cls = (typeof el.className === "string") ? el.className : "";
              if (cls.includes("animate") || cls.includes("transition") || cls.includes("fade") || cls.includes("slide")) return false;
            }
            return true;
          }
          return true;
        });

        if (hasStructural) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(done, quiet);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });

      // If DOM is already quiet, resolve after `quiet` ms
      timer = setTimeout(done, quiet);

      function done() {
        observer.disconnect();
        clearTimeout(maxTimer);
        if (timer) clearTimeout(timer);
        resolve(Date.now() - t0);
      }
    });
  }

  /* ───────────────────────────────────────────
   * Loading Indicator Detection
   * ─────────────────────────────────────────── */

  function detectLoadingState() {
    const indicators = [];

    // Check aria-busy
    try {
      const busyEls = document.querySelectorAll('[aria-busy="true"]');
      const visibleBusy = Array.from(busyEls).filter(el => isVisible(el));
      if (visibleBusy.length > 0) indicators.push({ type: "aria-busy", count: visibleBusy.length });
    } catch {}

    // Check common loading class patterns
    const loadingSelectors = [
      ".skeleton", ".loading", ".spinner", ".loader",
      '[class*="skeleton"]', '[class*="shimmer"]', '[class*="placeholder-glow"]'
    ];
    for (const sel of loadingSelectors) {
      try {
        const els = document.querySelectorAll(sel);
        const visible = Array.from(els).filter(el => isVisible(el));
        if (visible.length > 0) indicators.push({ type: sel, count: visible.length });
      } catch {}
    }

    // Check progress bars
    try {
      const progressBars = document.querySelectorAll('[role="progressbar"]');
      for (const pb of progressBars) {
        if (!isVisible(pb)) continue;
        const val = parseFloat(pb.getAttribute("aria-valuenow"));
        const max = parseFloat(pb.getAttribute("aria-valuemax") || "100");
        if (!isNaN(val) && val < max) {
          indicators.push({ type: "progressbar", value: val, max });
        }
      }
    } catch {}

    return { loading: indicators.length > 0, indicators };
  }

  /* ───────────────────────────────────────────
   * Workflow Recording Engine
   * ─────────────────────────────────────────── */

  let recordingActive = false;
  let recordedPageUrl = "";
  let inputDebounceTimer = null;
  let pendingInputEl = null;
  let urlCheckInterval = null;

  function buildCSSPath(el, maxDepth) {
    const parts = [];
    let current = el;
    for (let d = 0; d < maxDepth && current && current !== document.body; d++) {
      let segment = current.tagName.toLowerCase();
      if (current.id) { segment += "#" + current.id; parts.unshift(segment); break; }
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children)
          .filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          segment += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
        }
      }
      parts.unshift(segment);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function buildElementFingerprint(el) {
    if (!el || !el.getBoundingClientRect) return null;
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();

    // Multiple selector strategies
    const selectors = {};
    selectors.id = el.id || null;
    selectors.cssPath = buildCSSPath(el, 3);
    selectors.dataAttributes = {};
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-") && attr.name !== AGENT_ATTR) {
        selectors.dataAttributes[attr.name] = attr.value;
      }
    }

    // Parent and sibling context for disambiguation
    let parentText = "";
    if (el.parentElement) {
      parentText = getVisibleText(el.parentElement).slice(0, 100);
    }
    const siblingTexts = [];
    if (el.parentElement) {
      for (const sib of el.parentElement.children) {
        if (sib !== el) {
          const t = getVisibleText(sib);
          if (t) siblingTexts.push(t.slice(0, 50));
        }
        if (siblingTexts.length >= 5) break;
      }
    }

    return {
      selectors,
      tag,
      text: getVisibleText(el),
      ariaLabel: el.getAttribute("aria-label") || null,
      placeholder: el.placeholder || null,
      role: el.getAttribute("role") || null,
      type: el.type || null,
      href: el.href || null,
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y),
                w: Math.round(rect.width), h: Math.round(rect.height) },
      parentText,
      siblingTexts,
      inputValue: (tag === "input" || tag === "textarea" || tag === "select") ? el.value : null
    };
  }

  function describeRecordedAction(action, fingerprint, value) {
    const label = fingerprint ? (fingerprint.text || fingerprint.ariaLabel || fingerprint.placeholder || fingerprint.tag) : "";
    if (action === "click") return "Click on \"" + (label || "element").slice(0, 40) + "\"";
    if (action === "type") return "Type \"" + (value || "").slice(0, 30) + "\" in " + (label || "input");
    if (action === "select") return "Select \"" + (value || "").slice(0, 30) + "\" in " + (label || "dropdown");
    if (action === "navigate") return "Navigate to " + (value || "page");
    return action + " on " + (label || "element");
  }

  // Click handler (capture phase — fires before any preventDefault)
  function recordClick(e) {
    if (!recordingActive) return;
    const el = e.target;
    if (!el || !el.tagName) return;

    // Flush any pending input before recording click
    flushPendingInput();

    const fingerprint = buildElementFingerprint(el);
    const description = describeRecordedAction("click", fingerprint);

    chrome.runtime.sendMessage({
      type: "RECORD_ACTION",
      step: {
        action: "click",
        timestamp: Date.now(),
        pageUrl: window.location.href,
        pageTitle: document.title,
        fingerprint,
        value: null,
        description
      }
    }).catch(() => {});
  }

  // Input handler (debounced — captures final value)
  function recordInput(e) {
    if (!recordingActive) return;
    const el = e.target;
    if (!el || !el.tagName) return;
    const tag = el.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;

    pendingInputEl = el;
    clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(flushPendingInput, 300);
  }

  function flushPendingInput() {
    if (!pendingInputEl) return;
    const el = pendingInputEl;
    pendingInputEl = null;
    clearTimeout(inputDebounceTimer);

    const tag = el.tagName.toLowerCase();
    const action = tag === "select" ? "select" : "type";
    const value = el.value || "";
    if (!value) return; // Don't record empty inputs

    const fingerprint = buildElementFingerprint(el);
    const description = describeRecordedAction(action, fingerprint, value);

    chrome.runtime.sendMessage({
      type: "RECORD_ACTION",
      step: {
        action,
        timestamp: Date.now(),
        pageUrl: window.location.href,
        pageTitle: document.title,
        fingerprint,
        value,
        isParam: action === "type", // auto-flag type actions as parameterizable
        description
      }
    }).catch(() => {});
  }

  function startRecording() {
    recordingActive = true;
    recordedPageUrl = window.location.href;
    document.addEventListener("click", recordClick, true); // capture phase
    document.addEventListener("input", recordInput, true);
    document.addEventListener("change", recordInput, true);

    // SPA navigation detection (URL polling)
    urlCheckInterval = setInterval(() => {
      if (!recordingActive) return;
      const currentUrl = window.location.href;
      if (currentUrl !== recordedPageUrl) {
        // SPA navigation happened — record it
        chrome.runtime.sendMessage({
          type: "RECORD_ACTION",
          step: {
            action: "navigate",
            timestamp: Date.now(),
            pageUrl: currentUrl,
            pageTitle: document.title,
            url: currentUrl,
            fingerprint: null,
            value: null,
            description: "Navigate to " + currentUrl
          }
        }).catch(() => {});
        recordedPageUrl = currentUrl;
      }
    }, 500);
  }

  function stopRecording() {
    flushPendingInput();
    recordingActive = false;
    document.removeEventListener("click", recordClick, true);
    document.removeEventListener("input", recordInput, true);
    document.removeEventListener("change", recordInput, true);
    if (urlCheckInterval) { clearInterval(urlCheckInterval); urlCheckInterval = null; }
  }

  /* ───────────────────────────────────────────
   * Message Handler
   * ─────────────────────────────────────────── */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "WAIT_FOR_SETTLE") {
      const quiet = msg.quiet || 300;
      const maxWait = msg.maxWait || 3000;
      waitForDOMSettle(quiet, maxWait).then(elapsed => {
        sendResponse({ success: true, elapsed });
      });
      return true;
    }

    if (msg.type === "CAPTURE_STATE") {
      try {
        const state = capturePageState(msg.capOverride || 0);
        sendResponse({ success: true, state });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.type === "CAPTURE_SUMMARY") {
      try {
        const summary = capturePageSummary();
        sendResponse({ success: true, summary });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.type === "GET_PAGE_INFO") {
      try {
        sendResponse({
          success: true,
          info: {
            url: window.location.href,
            title: document.title,
            readyState: document.readyState,
            scrollY: Math.round(window.scrollY),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            documentHeight: document.documentElement.scrollHeight,
            devicePixelRatio: window.devicePixelRatio || 1
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.type === "EXECUTE_VISION_ACTION") {
      (async () => {
        try {
          const action = msg.action;
          const result = await executeVisionAction(action);
          if (action.action === "click" || action.action === "type") {
            await waitForPageStable();
          }
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (msg.type === "EXECUTE_ACTION") {
      (async () => {
        try {
          const result = await executeAction(msg.action);
          if (msg.action.action === "click" || msg.action.action === "navigate" || msg.action.action === "type") {
            await waitForPageStable(5000, msg.replayMode ? 200 : 500);
          }
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (msg.type === "CHECK_FOCUS") {
      var focusEl = document.activeElement;
      var editable = false;
      var focusTag = "";
      if (focusEl) {
        focusTag = focusEl.tagName || "";
        editable = (focusTag === "INPUT" || focusTag === "TEXTAREA" || focusEl.isContentEditable ||
                    focusEl.getAttribute("role") === "textbox");
      }
      sendResponse({ editable: editable, tag: focusTag });
      return;
    }

    if (msg.type === "GET_ELEMENT_BOUNDS") {
      (async () => {
        try {
          const el = resolveElement(msg.selector, msg.hints);
          if (!el) { sendResponse({ success: false, error: "Element not found" }); return; }
          if (!isElementInViewport(el)) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            await sleep(200);
          }
          const rect = el.getBoundingClientRect();
          // Detect media elements for special handling
          const mediaEl = el.tagName === "VIDEO" ? el
                        : el.tagName === "AUDIO" ? el
                        : el.querySelector ? (el.querySelector("video") || el.querySelector("audio")) : null;
          sendResponse({
            success: true,
            bounds: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            tag: el.tagName,
            isInput: el.tagName === "INPUT" || el.tagName === "TEXTAREA",
            isSelect: el.tagName === "SELECT",
            isContentEditable: !!el.isContentEditable,
            isMedia: !!(mediaEl && (mediaEl.tagName === "VIDEO" || mediaEl.tagName === "AUDIO")),
            hasForm: !!(el.form),
            type: el.type || null
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (msg.type === "GET_ELEMENT_SNAPSHOT") {
      // Get before/after state for CDP action verification
      try {
        const el = resolveElement(msg.selector, msg.hints);
        if (!el) { sendResponse({ success: false, error: "Element not found" }); return true; }
        const snap = snapshotElement(el);
        sendResponse({ success: true, snapshot: snap, tag: el.tagName, text: getVisibleText(el).slice(0, 80) });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.type === "DETECT_LOADING") {
      try {
        sendResponse({ success: true, ...detectLoadingState() });
      } catch (err) {
        sendResponse({ success: true, loading: false, indicators: [] });
      }
      return true;
    }

    if (msg.type === "FUZZY_FIND_ELEMENT") {
      try {
        const fp = msg.fingerprint;
        if (!fp) { sendResponse({ success: false, error: "No fingerprint" }); return true; }

        const candidates = [];
        const allElements = document.querySelectorAll(
          "a, button, input, textarea, select, [role='button'], [role='link'], " +
          "[role='textbox'], [role='searchbox'], [role='combobox'], [role='checkbox'], " +
          "[role='radio'], [role='tab'], [role='menuitem'], [tabindex], [onclick], " +
          "[contenteditable='true']"
        );

        for (const el of allElements) {
          if (!isVisible(el)) continue;
          const text = getVisibleText(el);
          const tag = el.tagName.toLowerCase();
          const ariaLabel = el.getAttribute("aria-label") || null;
          const placeholder = el.placeholder || null;
          const role = el.getAttribute("role") || null;
          const type = el.type || null;
          const href = el.href || null;
          const elId = el.id || null;

          let score = 0;

          // ID match = highest confidence
          if (fp.selectors && fp.selectors.id && elId === fp.selectors.id) score += 100;

          // Tag match
          if (fp.tag && tag === fp.tag) score += 10;

          // Text match
          if (fp.text && text) {
            if (fp.text === text) score += 40;
            else if (fp.text.toLowerCase() === text.toLowerCase()) score += 35;
            else if (text.toLowerCase().includes(fp.text.toLowerCase()) || fp.text.toLowerCase().includes(text.toLowerCase())) score += 20;
          }

          // AriaLabel match
          if (fp.ariaLabel && ariaLabel) {
            if (fp.ariaLabel === ariaLabel) score += 35;
            else if (ariaLabel.toLowerCase().includes(fp.ariaLabel.toLowerCase())) score += 20;
          }

          // Placeholder match
          if (fp.placeholder && placeholder) {
            if (fp.placeholder === placeholder) score += 30;
            else if (placeholder.toLowerCase().includes(fp.placeholder.toLowerCase())) score += 15;
          }

          // Role match
          if (fp.role && role && fp.role === role) score += 8;

          // Type match
          if (fp.type && type && fp.type === type) score += 8;

          // Href match
          if (fp.href && href) {
            if (fp.href === href) score += 25;
            else { try { if (new URL(fp.href).pathname === new URL(href).pathname) score += 15; } catch {} }
          }

          // Parent text similarity
          if (fp.parentText && el.parentElement) {
            const parentText = getVisibleText(el.parentElement).slice(0, 100);
            if (parentText && fp.parentText === parentText) score += 15;
            else if (parentText && parentText.includes(fp.parentText.slice(0, 30))) score += 8;
          }

          // Data attribute match
          if (fp.selectors && fp.selectors.dataAttributes) {
            for (const [attr, val] of Object.entries(fp.selectors.dataAttributes)) {
              if (attr !== "data-agent-id" && el.getAttribute(attr) === val) { score += 20; break; }
            }
          }

          if (score >= 25) {
            assignAgentId(el);
            candidates.push({
              score, selector: selectorFor(el), tag,
              text: text ? text.slice(0, 80) : "", ariaLabel, placeholder
            });
          }
        }

        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0 && candidates[0].score >= 35) {
          sendResponse({ success: true, match: candidates[0], alternates: candidates.slice(1, 3) });
        } else {
          sendResponse({ success: false, error: "No confident match", topScore: candidates[0]?.score || 0 });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    if (msg.type === "PING") {
      sendResponse({ alive: true });
      return true;
    }

    // ── Workflow Recording ──
    if (msg.type === "START_RECORDING") {
      startRecording();
      sendResponse({ success: true });
      return true;
    }

    if (msg.type === "STOP_RECORDING") {
      stopRecording();
      sendResponse({ success: true });
      return true;
    }

  });

  console.log("[WebWright] Content script v2 loaded on:", window.location.href);
})();
