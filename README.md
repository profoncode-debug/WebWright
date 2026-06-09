<div align="center">

# WebWright

### Built for action, not just browsing.

> ## **This is NOT a chat wrapper.**
> WebWright is a **real agentic AI** that lives in your browser sidebar.
> It **perceives** the page (DOM + vision), **reasons** about it with an LLM,
> and **takes real actions on your behalf** — clicks, types, navigates, fills
> forms, books, buys, researches. You can even talk to it **hands-free**.

**Tell it what you want. Watch it work.**

[Install](#installation) · [Features](#features) · [Architecture](#technical-architecture) · [Providers](#supported-providers) · [Privacy](#privacy--liability)

[![Add to Chrome](https://img.shields.io/badge/Add%20to%20Chrome-7c6aef?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/webwright-built-for-actio/nlcbeaapcgechkhncblkbebdlchaoknf)
[![GitHub Pages](https://img.shields.io/badge/Landing%20page-profoncode--debug.github.io%2FWebWright-7c6aef)](https://profoncode-debug.github.io/WebWright/)

<br>

![WebWright agent in action — autonomous YouTube task completion with live action log](screenshots/webwright_poster%20(1).png)

</div>

---

## Works on every Chromium browser

| Browser | Status |
|---------|--------|
| Google Chrome | ✅ Live on Chrome Web Store |
| Microsoft Edge | ✅ Install from Chrome Web Store |
| Brave / Opera / Vivaldi / Arc | ✅ Install from Chrome Web Store |
| Any Chromium-based browser | ✅ Manifest V3 compatible |
| Firefox | ❌ Different extension architecture |

> **Voice Mode note:** voice transcription uses the browser's built-in speech recognition by default, which **Brave disables for privacy**. On Brave (or for higher accuracy anywhere), switch the transcription engine to **Groq Whisper** in Settings → Speech-to-Text. Everything else works identically on all Chromium browsers.

---

## What is WebWright?

WebWright turns your browser into an **autonomous AI agent** — not a chat sidebar that answers questions, but a real agent that *acts*. You type (or say) a goal in plain English; the agent reads the page, navigates, clicks buttons, types into forms, escalates to vision when the DOM gets weird, and reports back with what happened.

```
You:        "Search Amazon India for Sony WH-CH520 headphones,
             sort by price low-to-high, open the cheapest in-stock listing."

Agent loop: 1. Navigated to amazon.in
            2. Search box found via DOM rank → query typed → Enter
            3. Sort dropdown clicked → "Price: Low to High" selected
            4. First in-stock card identified → opened
            5. Done — reports back with price and URL
```

### Why "agentic" actually means agentic here

WebWright runs a real **perceive → reason → act → re-perceive** loop, not a single prompt:

- **Perception loop** — the content script enumerates every interactive element on the page (`<button>`, `<a>`, `<input>`, custom roles, shadow-DOM nodes, iframes), ranks them by goal-relevance, and caps at 300. Refreshed every step.
- **Reasoning loop** — the background service worker builds a prompt out of `{ goal, page state, action history, last thinking, optional personal info }` and asks the model for **one** action as JSON.
- **Action loop** — the action is dispatched via the **Chrome DevTools Protocol** (CDP) so framework event handlers (React/Vue/Angular/Svelte) fire as if a human did it. Synthetic DOM events alone don't reliably trigger framework handlers — same reason Puppeteer and Playwright use CDP.
- **Action batching** — when the next 2–3 steps are obvious and low-risk (e.g. navigate → type → submit), the model may return them as one `plan` action in a **single response**, executed in sequence. This *reduces* round-trips; it is not a separate planning call.
- **Vision escalation** — when DOM-only fails (canvases, opaque custom elements, missing selectors), the agent autonomously climbs a 4-tier ladder: DOM → 80-mark vision → 160-mark vision → raw coordinate clicks.
- **Anti-loop detection** — the agent monitors its own action history for repetition, A-B-A oscillation, scroll stagnation, and silent failures (action returned "success" but the page didn't change), and changes strategy automatically.

That is an agent loop. Not an autocomplete prompt.

---

## Features

### 🎙️ Voice Mode (NEW) — Hands-free browsing companion
Toggle the mic and **talk to your browser**. WebWright transcribes your speech, auto-decides whether you're chatting or asking for an action, runs it, and **speaks back** in a warm, natural voice. It's a genuine conversational loop with four clear states shown in the bar:

| State | Meaning | Mic |
|-------|---------|-----|
| **Listening…** | Waiting for / capturing your speech | live |
| **Thinking…** | Classifying intent + generating a reply | ignored |
| **Working…** | An agent task you asked for is running | ignored |
| **Speaking…** | Reading the reply aloud | ignored |

- **Speech-to-text engines:** **Browser (Chrome)** by default — free, on-device prompt, audio handled by the browser's speech service. Or **Groq Whisper** (`whisper-large-v3-turbo`) for higher accuracy and for browsers like **Brave** that disable the built-in engine. Pick the engine and paste a free Groq key in Settings → Speech-to-Text.
- **Text-to-speech:** fully **on-device** (`speechSynthesis`). Replies are cleaned for the ear — no URLs, markdown, or emojis read aloud.
- **Personality:** a warm, upbeat, lightly-playful companion that keeps replies short (5–7 spoken sentences) and emotional, not robotic.
- **Memory:** keeps the last ~20 voice turns in memory **including the agent actions it performed for you**, so you can ask *"what did you just do?"* and it remembers. Cleared when you turn voice off.
- **Auto-routing:** ask it to *do* something ("open YouTube and play lofi") and it runs the agent automatically — no buttons. While the agent works, the mic is off and the bar shows **Working…**, then it resumes listening when done.

### Agent Mode — Autonomous task execution
Give a goal, the agent runs the loop until done. It will:
- Navigate the current tab and interact with page elements
- Fill out forms using your saved **Personal Info Vault** (keyword-gated)
- Handle complex multi-step flows (login, search, checkout, booking)
- Auto-escalate from DOM analysis to visual understanding when stuck
- Batch low-risk sequential actions into a single response for faster execution

![Agent Mode — WebWright autonomously opening YouTube, searching, and reporting results](screenshots/webwright_poster%20(1).png)

### One smart input — no mode buttons
There's a single input and a single **Send** button. WebWright classifies each message and routes it for you:

| You press | What happens |
|-----------|--------------|
| **Enter** | Auto-routes: a question → Chat, an instruction → Agent (LLM intent classifier) |
| **Ctrl+Enter** | Forces **Agent mode** regardless of phrasing |

Agent tasks always run on the **current tab** — WebWright never hijacks a new one.

### Chat Mode — Talk to any web page
Multi-turn Q&A grounded in the page you're viewing, with **full markdown + LaTeX rendering** (tables, math, code blocks, GFM extensions). Replies that include `$E = mc^2$` or `$$\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$$` typeset properly via bundled KaTeX.

The page context **re-grounds automatically** when you navigate the tab or switch to a different tab — your conversation is kept, only the page content is refreshed.

Two modes per message via the pill above the input:

| Mode | What it does | Best for |
|------|--------------|----------|
| **Quick** | Sends only the page text. Fastest, cheapest. | Articles, blog posts, plain-text pages |
| **Pro** | Also attaches a live screenshot so a vision-capable model can *see* the layout. | Dashboards, image-heavy pages, anywhere layout matters |

Mode choice persists across sessions.

![Chat Mode — explaining the Hilbert Hotel paradox while viewing a Veritasium video](screenshots/webbwright_chat.png)

### Vision Escalation — 4-tier intelligence (Agent Mode)

| Tier | Method | Trigger |
|------|--------|---------|
| 1 | **DOM Analysis** | Default — fast, token-efficient |
| 2 | **Vision + 80 Set-of-Marks elements** | DOM action fails, element not found, or loop detected |
| 3 | **Vision + 160 elements** | Tier 2 still couldn't resolve |
| 4 | **Raw Coordinates** | Last resort — LLM picks (x,y) on the screenshot; dispatched via CDP `Input.dispatchMouseEvent` |

Screenshots are annotated with color-coded numbered boxes (Set-of-Marks): red = buttons, blue = links, green = inputs, amber = checkboxes/radios, purple = selects, cyan = custom components. The LLM picks an element by number; the agent maps it back to a real selector or coordinate.

### Research Mode — Deep web research

1. Searches Google and captures the AI Overview via screenshot + vision LLM
2. Extracts the top 10 organic result URLs from the SERP
3. Visits each source, scrapes text (with vision fallback for low-text pages)
4. Summarizes each source individually using a dedicated **Research Model** (45 s LLM timeout, 60 s hard cap per source)
5. Synthesizes a final cross-source conclusion
6. Opens a polished multi-column HTML report in a new tab

Drawer shows live per-source progress (active / done / error / skipped), an instant **Abort** button, and a history of previous reports you can re-open or delete.

![Research Mode — Google AI Overview, 10 source summaries, and a synthesized report](screenshots/webwright_poster_research.png)

### Workflows — Record and replay
Record an arbitrary browser action sequence across tabs, save with a name, replay with one click. Two-tier fallback during replay: **exact-selector match** first; if the element moved, **fuzzy fingerprint match** against ranked candidates. No LLM call needed for clean replays.

### Personal Info Vault
Locally-stored personal details for form-filling. **The vault is only included in the LLM prompt when the goal contains one of ~20 form-related keywords** (`fill`, `form`, `register`, `signup`, `apply`, `checkout`, `booking`, `my name`, `my address`, etc.). Chat Mode, Voice Mode, Research Mode, and workflow replay never see your vault, regardless of what's in the message.

### Smart Suggestions
A pool of 30+ pre-built task suggestions. A few random chips rotate on each session for one-tap launches.

![WebWright sidebar with task suggestions and the Settings panel showing the 8 LLM providers](screenshots/webwright_poster_config_workflows%20(2).png)

---

## Technical Architecture

### Action loop (per step)

```
┌──────────────────────────────────────────────────────────────────┐
│                       AGENT LOOP (one step)                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐                                             │
│  │  Capture state  │  capturePageState(tabId)                    │
│  │  DOM + frames + │  → up to 300 ranked interactive elements    │
│  │  shadow DOM     │  → URL, title, viewport, scroll position    │
│  └────────┬────────┘                                             │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │  Build prompt   │  buildDOMPrompt(goal, state, history,       │
│  │                 │    chatContext, lastThinking, vault?)       │
│  │                 │  + RECENT ACTIONS (last 10 full + older     │
│  │                 │    summarized as one-liners)                │
│  └────────┬────────┘                                             │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │   Call LLM      │  callLLM(msgs, model, "DOM",                │
│  │                 │    forceJson: true)                         │
│  │                 │  → { action, id, value, … }                 │
│  └────────┬────────┘                                             │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │ Dispatch action │  CDP path:                                  │
│  │                 │   • Input.dispatchMouseEvent (clicks,       │
│  │                 │     hovers, scrolls, double-clicks)         │
│  │                 │   • Input.dispatchKeyEvent (typing, keys)   │
│  │                 │   • Input.insertText (fast text entry)      │
│  │                 │  Synthetic fallback when CDP unavailable.   │
│  └────────┬────────┘                                             │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │  Verify effect  │  Re-snapshot the targeted element;          │
│  │                 │  diff against pre-state; check `urlChanged` │
│  │                 │  and SPA `webNavigation` events.            │
│  └────────┬────────┘                                             │
│           ▼                                                      │
│  ┌─────────────────┐    Loop? Stuck?                             │
│  │  Anti-loop      │ ──> escalate to next vision tier            │
│  │  detector       │     or pick alternative strategy            │
│  └────────┬────────┘                                             │
│           ▼                                                      │
│  ┌─────────────────┐                                             │
│  │  Push history   │  10 most recent kept in full;               │
│  │  entry          │  older entries summarized                   │
│  └─────────────────┘                                             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Component map

```
┌────────────────────────────────────────────────────────────────┐
│  SIDE PANEL (sidepanel/sidepanel.html + sidepanel.js)          │
│  • Chat view, agent log, research drawer, voice bar           │
│  • Provider/model settings, workflow controls, vault           │
│  • VoiceController: STT (Web Speech / Groq Whisper) + TTS      │
│  • Renders marked.js (markdown) + KaTeX (math) for chat        │
│  ↕ chrome.runtime.sendMessage                                  │
├────────────────────────────────────────────────────────────────┤
│  BACKGROUND SERVICE WORKER (background/background.js)          │
│  • runAgentLoop, handleChatMessage, voice chat handler         │
│  • callLLM (8 providers, abort-controller, timeout)            │
│  • CDP attach/detach, Input.* dispatch, Network.* idle wait    │
│  • Research pipeline (Google → 10 sources → synthesis)         │
│  • Vision tier orchestration (Set-of-Marks overlay)           │
│  • Intent classifier (chat vs agent) for the unified input    │
│  ↕ chrome.tabs.sendMessage  +  chrome.scripting.executeScript  │
├────────────────────────────────────────────────────────────────┤
│  CONTENT SCRIPT (content/content.js)                           │
│  • Interactive element extraction (TreeWalker, shadow DOM,     │
│    iframes via runAt:"document_idle", all_frames:true)         │
│  • Ranking (size, viewport-proximity, goal-keyword match)      │
│  • Action execution (fallback synthetic events when CDP off)   │
│  • Workflow recording (clicks, typing, navigation across tabs) │
│  • Set-of-Marks overlay rendering for vision tiers             │
└────────────────────────────────────────────────────────────────┘
```

### Why CDP for input

Synthetic DOM events (`element.click()`, `dispatchEvent(new MouseEvent(…))`) **do not reliably trigger** event handlers in React, Vue, Angular, or Svelte — the frameworks check `isTrusted` on the event object and ignore untrusted events for many handlers. CDP-dispatched events arrive as **trusted** at the renderer level. This is the same reason Puppeteer and Playwright use CDP for input.

The `debugger` permission is **always attached for the duration of an Agent task** on the working tab (not just Tier-4 fallback). Only the `Input.*` and `Network.*` CDP domains are used:

- `Input.dispatchMouseEvent` — clicks, hovers, scrolls, double-clicks
- `Input.dispatchKeyEvent` — keys (Tab, Enter, arrows, modifiers)
- `Input.insertText` — fast text entry into focused inputs
- `Network.enable` + `Network.requestWillBeSent` / `Network.loadingFinished` — purely to **count pending requests** for network-idle detection (request/response bodies are never inspected)

No `Storage.*`, no DOM introspection, no JS evaluation in the page context, no background activity. The debugger detaches the moment the task ends.

### Unified input routing

Every typed message and every spoken phrase goes through `CLASSIFY_MESSAGE` — a lightweight LLM intent classifier (with a fast keyword pre-check) that decides **chat vs agent**. The UI echoes your message instantly, then routes: questions become grounded chat replies, instructions launch the agent on the current tab. **Ctrl+Enter** skips the classifier and forces agent mode.

### Action history window

`RECENT_HISTORY_COUNT = 10`. The last 10 history entries are rendered in full detail (action, target, result, page URL, stateAfter diff). Older entries are compressed to one-line summaries via `summarizeHistoryEntry`, keeping the prompt bounded as a task runs long.

### Voice pipeline

The `VoiceController` (in `sidepanel.js`) runs the speech loop entirely client-side. **STT** is either the browser's `webkitSpeechRecognition` (continuous, with a silence-timeout that finalizes an utterance) or a **Groq Whisper** path that records the mic with `MediaRecorder`, slices utterances with a small Web-Audio volume VAD, and POSTs the clip to Groq's transcription endpoint. Both feed the same router. **TTS** uses on-device `speechSynthesis` with a watchdog (Chrome's `onend` is unreliable) so the Speaking→Listening transition never gets stuck. Voice chat uses a **separate** persona + in-memory history on the background side, so it never affects typed chat.

### Vision (Set-of-Marks)

When the agent escalates, the content script renders an SVG overlay on top of the page with up to 80 or 160 numbered boxes color-coded by element type. `chrome.tabs.captureVisibleTab` snapshots the result. The LLM picks an `"element": <number>` instead of guessing a CSS selector. The agent maps the number back to either a real selector or fallback coordinates.

### Markdown + math in chat

The sidebar uses **marked.js** (markdown → HTML, GFM extensions enabled: tables, strikethrough, task lists, autolinks) and **KaTeX** (LaTeX math, both inline `$…$` and display `$$…$$`). Both libraries are bundled locally in `lib/` — no remote code is loaded.

---

## Supported Providers

8 LLM providers out of the box. **Every model field is editable in Settings**, so you can swap to any model the provider exposes (newer Claude/Gemini/GPT releases, alternate Ollama models, fine-tuned variants).

| Provider | Default Agent Model | Default Vision Model | Free Tier | API format |
|----------|--------------------|----------------------|-----------|------------|
| **Ollama Cloud** | `gpt-oss:120b-cloud` | `gemma4:31b-cloud` | Yes | Ollama |
| **Ollama Local** | `qwen2.5-coder:7b` | `llava:13b` | Yes (self-hosted) | Ollama |
| **OpenAI** | `gpt-4o` | `gpt-4o` | No | OpenAI |
| **Claude** | `claude-sonnet-4-20250514` | `claude-sonnet-4-20250514` | No | Anthropic |
| **Gemini** | `gemini-2.0-flash` | `gemini-2.0-flash` | Yes | Gemini |
| **DeepSeek** | `deepseek-chat` | — | Yes | OpenAI |
| **Grok** | `grok-3-mini` | — | No | OpenAI |
| **Custom** | User-defined | User-defined | Depends | OpenAI- or Ollama-compatible |

> **Model slots per provider:** Agent Model · Vision Model · Chat Model · (Ollama Cloud only) Research Model. Pick a frontier reasoning model for the agent, a vision-capable model for the visual escalation tiers, a cheap/fast model for chat. The "Custom" dropdown entry on Ollama Cloud lets you paste any free-form model name — including ones released after this build.
>
> **Voice transcription** (optional) uses **Groq Whisper** and is configured separately under Settings → Speech-to-Text — it is independent of the chat/agent LLM provider above.

---

## Installation

### Option A — Chrome Web Store (recommended)

[**→ Add to Chrome**](https://chromewebstore.google.com/detail/webwright-built-for-actio/nlcbeaapcgechkhncblkbebdlchaoknf)

Works on Chrome, Edge, Brave, Opera, Vivaldi, and Arc — they all support the Chrome Web Store. First-time Edge users may see "Allow extensions from other stores" → click Allow.

### Option B — Load unpacked (for developers / pre-release versions)

```bash
git clone https://github.com/profoncode-debug/WebWright/
```

1. Open your browser's extensions page (`chrome://extensions/`, `edge://extensions/`, `brave://extensions/`, etc.)
2. Enable **Developer mode**
3. **Load unpacked** → select the `agentic-browser-ext` folder
4. Pin the WebWright icon to your toolbar

---

## Quick Start

### Run an Agent task
1. Click the WebWright icon → side panel opens
2. Type: *"Open YouTube and search for lofi study music"*
3. Press **Enter** (auto-routes to Agent) or **Ctrl+Enter** to force it
4. Watch the agent execute it step-by-step in the live log

### Chat about a page
1. Navigate to any article / dashboard
2. Pick **Quick** or **Pro** from the mode pill
3. Type a question, press **Enter**
4. Math equations, tables, and code render properly — and it re-grounds if you switch pages

### Talk to it hands-free (Voice Mode)
1. Click the **mic** button in the side panel
2. (On Brave, or for best accuracy) set Settings → Speech-to-Text to **Groq Whisper** and paste a free Groq key
3. Just talk — ask a question and it answers aloud, or say *"open Gmail and start a new email"* and it runs the task, then resumes listening

### Research a topic
1. Click the magnifying-glass icon → Research drawer opens
2. Enter a topic: *"Recent advances in agentic AI"*
3. Click **Research** — watch real-time per-source progress
4. Multi-column HTML report opens in a new tab

### Fill a form
1. Open the **Personal Info** drawer (person icon), save your details
2. Navigate to a form page
3. Type: *"Fill this form with my saved info"*
4. The vault is included in the prompt only because your goal matched the form-fill keyword list

---

## Prompts and Models Matter

WebWright's accuracy is a function of two things you control: how specifically you prompt it, and which model you point it at.

| ❌ Vague prompt | ✅ Specific prompt |
|----------------|------------------|
| *"Buy headphones"* | *"Search Amazon India for Sony WH-CH520 headphones, sort by price low-to-high, open the cheapest in-stock listing."* |
| *"Book a flight"* | *"Open Google Flights, find the cheapest non-stop flight from Delhi to Tokyo on July 15, return July 22, for 1 adult."* |
| *"Summarize this"* | *"Summarize this article in 5 bullet points, focusing on the financial figures and any regulatory mentions."* |

| Model class | Suitability for agent loops |
|-------------|------------------------------|
| Frontier reasoning (GPT-4o, Claude Sonnet 4, Gemini 2.0 Flash, large Ollama Cloud models) | Best — handles long action histories, recovers from errors, strong vision |
| Mid-tier (DeepSeek-Chat, Grok-3-mini, gemma4:31b) | Good for everyday navigation; may stall on complex multi-step flows |
| Small local models (qwen2.5-coder:7b, llava:13b) | Works for simple tasks; expect retries and dead-ends on complex sites |

If a task fails: try a stronger model **and** a more specific prompt before assuming it's an agent bug. Most "the agent is dumb" outcomes turn out to be one of those two.

---

## File Layout

```
agentic-browser-ext/
├── manifest.json            # Manifest V3
├── privacy-policy.html      # Privacy policy + permission justifications
├── index.html               # GitHub Pages landing site
├── mic-permission.html      # Microphone permission helper for Voice Mode
├── background/
│   └── background.js        # Agent loop, LLM call, CDP dispatch, intent
│                            # classifier, vision escalation, research,
│                            # voice chat handler (~4,800 LoC)
├── content/
│   └── content.js           # DOM extraction, ranking, SoM overlay, replay
├── sidepanel/
│   ├── sidepanel.html       # Chat, agent log, drawers, voice bar
│   └── sidepanel.js         # UI logic, markdown + math, settings, VoiceController
├── lib/                     # Bundled libraries — no remote code loaded
│   ├── marked.min.js        # Markdown parser (GFM)
│   ├── katex.min.js         # LaTeX math typesetting
│   ├── katex.min.css        # KaTeX styles
│   ├── auto-render.min.js   # Auto-find $…$ delimiters
│   └── fonts/               # KaTeX woff2 fonts (20 files)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── screenshots/             # Landing-page assets (not bundled in CWS package)
```

**Zero npm dependencies. No build step. No remote code. Pure vanilla JS.**

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Provider | Ollama Cloud | Which LLM to use for chat / agent |
| Max Steps | 20 | Auto-stop after N actions |
| Step Delay | 2000 ms | Pause between actions |
| LLM Timeout | 100 s | Max wait per LLM call (overridable per call type) |
| Wall Timeout | 300 s | Max total task duration |
| Research Model | `gemma4:31b-cloud` (Ollama Cloud only) | Falls back to primary model on other providers |
| Chat Mode | Pro | Default chat-input mode (Pro attaches screenshot; switch to Quick from pill) |
| Speech-to-Text Engine | Browser (Chrome) | Voice transcription engine — Browser or **Groq Whisper** (auto-used on Brave) |
| Groq API Key | — | Stored locally; required only when the Groq Whisper engine is selected |

---

## Permissions

WebWright requests only what it needs to run as a browser agent. Full per-permission justifications (matching the Chrome Web Store submission) live in [`privacy-policy.html`](privacy-policy.html).

| Permission | Why |
|------------|-----|
| `activeTab` / `tabs` | Identify the active tab, inject the content script, capture screenshots via `chrome.tabs.captureVisibleTab`, drive `chrome.tabs.create` / `update` / `remove` for the agent's working tab |
| `scripting` | `chrome.scripting.executeScript` injects `content/content.js` for DOM extraction and action execution |
| `storage` | `chrome.storage.local` persists settings, API keys, Personal Info Vault, workflows, research reports. `chrome.storage.sync` is **not** used — data never leaves the device |
| `sidePanel` | Display the WebWright sidebar UI |
| `webNavigation` | One `chrome.webNavigation.onHistoryStateUpdated` listener — detects React-Router / Next.js SPA navigations so the agent re-perceives the page state |
| `debugger` | Powers the CDP input dispatcher. Attached when an Agent task starts, detached when it ends. Only `Input.*` and `Network.*` CDP domains used (the latter purely for request-count idle detection — bodies never inspected). Never used for DOM introspection, JS evaluation, cookie/localStorage access, or background activity |
| `<all_urls>` | The user — not the developer — decides which site the agent operates on at runtime. A narrow host pattern would prevent the agent from doing what the user installed it for |

**Microphone** (Voice Mode only) is requested at runtime via the standard browser prompt the first time you enable voice — it is not a manifest permission and is never accessed otherwise.

**No remote code is loaded.** All extension JavaScript is bundled in the published package, including `lib/marked.min.js` and `lib/katex.min.js`.

---

## Privacy & Liability

WebWright stores all your data **locally** on your device. It only sends data to the LLM provider **you** choose and configure. There are no first-party servers, analytics, or telemetry.

**Voice Mode disclosure:** text-to-speech is fully on-device. Speech-to-text sends your microphone audio to a transcription service — **Google's** speech backend when using the default Browser engine, or **Groq** when you select the Groq Whisper engine (the default on Brave). No audio is stored by WebWright; it is sent only to produce a transcript and then discarded.

The full policy is in [`privacy-policy.html`](privacy-policy.html). It also contains a **Disclaimer of Liability**:

> WebWright is provided "as is". The developer is **not responsible** for any monetary loss, data loss, account suspension, legal consequences, or any other harm — direct or indirect — that may result from the use or misuse of this extension. The agent acts autonomously on your behalf based on your instructions, so **the user is solely responsible for all actions taken by the agent**, including financial transactions, submitted forms, and compliance with the terms of service of any site visited.
>
> **By installing, enabling, or using WebWright, you acknowledge and agree to these terms in full.** If you do not agree, please uninstall the extension.

---

## Contributing

PRs welcome — especially:
- New provider integrations in `callLLM` (background.js)
- New element-ranking heuristics in `rankElements` (background.js)
- Vision-tier improvements (Set-of-Marks rendering in content.js)
- Tests — there are currently none; structured agent-loop tests would be a great first PR

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes
4. Submit a PR

---

## License

MIT

---

<div align="center">

**WebWright** — Stop browsing. Start commanding.

</div>
