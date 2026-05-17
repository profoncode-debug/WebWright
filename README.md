<div align="center">

# WebWright

### Built for action, not just browsing.

> ## **This is NOT a chat wrapper.**
> WebWright is a **real agentic AI** that lives in your browser sidebar.
> It **perceives** the page (DOM + vision), **reasons** about it with an LLM,
> and **takes real actions on your behalf** — clicks, types, navigates,
> fills forms, books, buys, researches. It does not just answer questions
> *about* the web; it **does things on** the web for you.

**Tell it what you want. Watch it work.**

[Install](#installation) | [Features](#features) | [Providers](#supported-providers) | [How It Works](#how-it-works) | [Privacy](#privacy--liability) | [Contributing](#contributing)

</div>

---

## Works on every Chromium browser

| Browser | Supported |
|---------|-----------|
| ![Chrome](https://img.shields.io/badge/Google%20Chrome-✓-success) | Yes |
| ![Edge](https://img.shields.io/badge/Microsoft%20Edge-✓-success) | Yes |
| ![Brave](https://img.shields.io/badge/Brave-✓-success) | Yes |
| ![Opera](https://img.shields.io/badge/Opera-✓-success) | Yes |
| ![Vivaldi](https://img.shields.io/badge/Vivaldi-✓-success) | Yes |
| ![Arc](https://img.shields.io/badge/Arc-✓-success) | Yes |
| ![Chromium](https://img.shields.io/badge/Any%20Chromium-✓-success) | Yes |

WebWright is a Manifest V3 extension. **If your browser is built on Chromium, it works.** That includes Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi, Arc, and any other Chromium-based browser. (Firefox is not supported — it uses a different extension architecture.)

---

## What is WebWright?

WebWright turns your browser into an **autonomous AI agent** — not a chat sidebar that answers questions, but a real agent that *acts*. It fills forms, navigates sites, clicks buttons, searches the web, books tickets, conducts deep research, and more. No Mac Mini, no VPS, no high RAM usage. Just a lightweight extension under 1 MB.

Type a goal like *"Search Amazon for wireless headphones under $50"* and the agent takes over: it navigates to Amazon, types the search query, applies filters, and reports back what it found — all while you watch the real-time action log in the sidebar.

### Why "agentic" actually means agentic here
- **Perception loop** — the content script extracts and ranks every interactive element on the page (buttons, links, inputs, dropdowns, custom components, shadow DOM) every step.
- **Reasoning loop** — the LLM is given page state + goal + action history and must pick *one* concrete next action as JSON.
- **Action loop** — the action is executed in the real DOM (or via raw coordinate clicks when DOM fails), the page state is re-read, and the cycle repeats.
- **Vision escalation** — when DOM is not enough, the agent autonomously switches to screenshot-based reasoning with Set-of-Marks element overlays.
- **Anti-loop detection** — the agent monitors itself for repeated actions, A-B-A oscillation, and silent failures, and changes strategy on its own.

That is an agent loop. Not an autocomplete prompt.

## Features

### Agent Mode — Autonomous Task Execution
Give the agent a goal in plain English. It will:
- Navigate to websites and interact with page elements
- Fill out forms using your saved personal info
- Handle complex multi-step flows (login, search, checkout, booking)
- Automatically escalate from DOM analysis to visual understanding when stuck
- Batch low-risk sequential actions into plans for faster execution

### Chat Mode — Talk to Any Web Page
Ask questions about the page you're viewing:
- *"Summarize this article"*
- *"What are the key points on this page?"*
- *"Explain this in simple terms"*

Multi-turn conversation with full page context.

#### ⚡ Quick vs ✨ Pro
A toggle next to the input lets you choose how the chat thinks:

| Mode | Icon | What it does | Best for |
|------|------|--------------|----------|
| **Quick** | ⚡ | Sends only the page text to the LLM. Fastest, cheapest. | Articles, blog posts, plain text pages. |
| **Pro** | ✨ | Also attaches a live screenshot of the page so a vision-capable model can *see* the layout, charts, and visual elements. | Complex dashboards, image-heavy pages, anything where layout matters. |

Switch modes any time from the pill above the input — your choice is remembered locally.

### Vision Escalation — 4-Tier Intelligence (Agent Mode)
When simple DOM reading isn't enough, WebWright automatically escalates:

| Tier | Method | When |
|------|--------|------|
| 1 | **DOM Analysis** | Default — fast, token-efficient |
| 2 | **Vision + 80 Elements** | DOM action fails, element not found, or stuck in loop |
| 3 | **Vision + 160 Elements** | Vision 80 couldn't resolve the issue |
| 4 | **Raw Coordinates** | Last resort — clicks by X,Y position on screenshot via the Chrome DevTools Protocol |

Each tier adds more visual context. The agent annotates screenshots with color-coded numbered markers (Set-of-Marks) so the LLM can see and understand every interactive element.

### Research Mode — Deep Web Research
Open the **Research** drawer (magnifying-glass icon in the header), enter a topic, and WebWright handles the rest:

1. Searches Google and captures the AI Overview via screenshot + vision LLM
2. Extracts the top 10 organic result URLs directly from the SERP
3. Visits each source, scrapes text (with vision fallback for low-text pages)
4. Summarizes every source individually using a dedicated **Research Model** (45s LLM timeout, 60s hard cap per source)
5. Synthesizes a final conclusion across all sources
6. Opens a polished multi-column HTML report in a new tab

The drawer shows live per-source progress (active / done / error / skipped), an instant **Abort** button, and a history of previous reports you can re-open or delete. Configure the Research Model separately from your chat/agent model in Ollama Cloud settings. On other providers (including Ollama Local), research falls back to your primary model.

### Workflows — Record and Replay
- **Record** your browser actions (clicks, typing, navigation) across tabs
- **Save** them as named workflows
- **Replay** them anytime with one click — with pause/resume controls

### Personal Info Vault
Store your details locally (never sent to any server) for instant form filling:
- Name, Age, Sex, Father's Name, Mother's Name, Address
- 5 custom fields for anything else (email, phone, etc.)
- Agent uses these **only** when the task involves filling a form

### Smart Suggestions
A pool of 30+ pre-built task suggestions across categories — navigation, productivity, shopping, search, and utilities. A few random chips rotate on each session for one-tap launches.

## Supported Providers

WebWright works with **8 LLM providers** out of the box. The defaults below are what you get on a fresh install — **every model field is freely editable in Settings**, so you can swap to any model the provider exposes (newer Claude/Gemini/GPT releases, alternate Ollama models, fine-tuned variants, etc.).

| Provider | Default Agent Model | Default Vision Model | Free Tier |
|----------|--------------------|----------------------|-----------|
| **Ollama Cloud** | `gpt-oss:120b-cloud` | `gemma4:31b-cloud` | Yes |
| **Ollama Local** | `qwen2.5-coder:7b` | `llava:13b` | Yes (self-hosted) |
| **OpenAI** | `gpt-4o` | `gpt-4o` | No |
| **Claude** | `claude-sonnet-4-20250514` | `claude-sonnet-4-20250514` | No |
| **Gemini** | `gemini-2.0-flash` | `gemini-2.0-flash` | Yes |
| **DeepSeek** | `deepseek-chat` | — | Yes |
| **Grok** | `grok-3-mini` | — | No |
| **Custom** | User-defined | User-defined | Depends |

> **All models are user-adjustable.** Open the gear icon → pick a provider tab → change the Agent Model, Vision Model, Chat Model, or (Ollama Cloud only) Research Model fields. Ollama Cloud's dropdowns show curated cloud-hosted models, but every field also accepts a free-form model name so you can paste in any model your provider supports — including ones released after this build. Custom Provider lets you point at any OpenAI- or Ollama-compatible endpoint with your own model name.

Bring your own API key — or run fully local with Ollama.

## Installation

WebWright works on **Chrome, Microsoft Edge, Brave, Opera, Vivaldi, Arc, and any other Chromium-based browser**. The steps below use Chrome's URL — replace it with your browser's equivalent (`edge://extensions/`, `brave://extensions/`, `opera://extensions/`, etc.).

1. Clone this repo:
   ```bash
   git clone https://github.com/profoncode-debug/WebWright/
   ```
2. Open your browser's extensions page:
   - Chrome → `chrome://extensions/`
   - Edge → `edge://extensions/`
   - Brave → `brave://extensions/`
   - Opera / Vivaldi → their respective `://extensions/` URL
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `agentic-browser-ext` folder
5. Pin the extension to your toolbar

> Coming soon: one-click install from the Chrome Web Store and Microsoft Edge Add-ons.

## Quick Start

### Run a Task (Agent Mode)
1. Click the WebWright icon to open the sidebar
2. Type a goal: *"Open YouTube and search for lofi music"*
3. Press **Ctrl+Enter** (or click the play button)
4. Watch the agent work in real-time

### Chat About a Page
1. Navigate to any article or webpage
2. Open the sidebar and pick **⚡ Quick** or **✨ Pro** from the mode pill
3. Type: *"Summarize this page"*
4. Press **Enter** (or click the chat button)

### Research a Topic
1. Click the **Research** icon (magnifying glass) in the sidebar header
2. Enter a topic: *"Quantum computing breakthroughs 2025"*
3. Click **Research** and watch real-time per-source progress
4. A formatted report opens in a new tab with a conclusion and multi-column source summaries
5. Re-open or delete past reports from the same drawer

### Fill a Form
1. Open the **Personal Info** drawer (person icon in header) and save your details
2. Navigate to any form page
3. Type: *"Fill out this form with my info"*
4. The agent reads your saved data and fills every field

## Accuracy: Prompts and Models Matter

> **WebWright is an agent, not a magic box. Its accuracy is a function of two things you control: the way you prompt it, and the model you point it at.**

### Prompting matters
The agent gets exactly one chance per step to interpret your goal. Vague goals produce vague behavior. Concrete goals with specifics — names, numbers, constraints, success criteria — produce reliable behavior.

| ❌ Weak prompt | ✅ Strong prompt |
|----------------|------------------|
| *"Buy headphones"* | *"Search Amazon India for Sony WH-CH520 wireless headphones, sort by price low-to-high, and open the cheapest in-stock listing."* |
| *"Book a flight"* | *"Open Google Flights, find the cheapest non-stop flight from Delhi to Tokyo on July 15, return July 22, for 1 adult."* |
| *"Summarize this"* | *"Summarize this article in 5 bullet points, focusing on the financial figures and any mention of regulatory action."* |

Tips for strong prompts:
- **Name the site** when relevant (*"on Flipkart"*, *"on Reddit"*) — this saves the agent a navigation step.
- **State a stop condition** (*"and report the top 3 prices"*, *"until you find one under ₹2000"*) — without one the agent will keep going until Max Steps.
- **Spell out filters and constraints** up front — under $X, in stock, before this date, in this city.
- **Avoid pronouns** like *"do that again"* — restate the actual goal.

### Model matters
The same prompt on different models will not produce the same result. Larger, more recent, more reasoning-capable models follow long agent loops more reliably and are far better at vision escalation.

| Model class | Suitability for agent loops |
|-------------|------------------------------|
| Frontier reasoning (GPT-4o, Claude Sonnet 4, Gemini 2.0 Flash, gpt-oss:120b-cloud) | Best — handles long action histories, recovers from errors, strong vision |
| Mid-tier (DeepSeek-Chat, Grok-3-mini, gemma4:31b) | Good for everyday navigation; may stall on complex multi-step flows |
| Small local models (qwen2.5-coder:7b, llava:13b) | Works for simple tasks; expect retries and occasional dead-ends on complex sites |

**Vision-capable model required for Tier 2-4 escalation.** If you point the agent at a text-only model and it hits a page where DOM clicks fail, it cannot recover via screenshots. Pair text models with a separate vision model (the **Vision Model** field in Settings).

If a task fails: try a stronger model **and** a more specific prompt before assuming it's an agent bug. Most "the agent is dumb" outcomes turn out to be one of the two.

## How It Works

```
  You: "Book a table at the nearest Italian restaurant"
   |
   v
 [Intent Classification] ──> Chat Mode (if question)
   |
   v  (action detected)
 [DOM Extraction] ── Extract & rank interactive elements (cap: 300)
   |
   v
 [LLM Reasoning] ── Pick one action based on goal + page state + history
   |
   v
 [Action Execution] ── click, type, select, scroll, navigate, wait
   |
   v
 [Result Check] ── Did it work?
   |       |
   |     [No] ──> Vision Escalation (screenshot + Set-of-Marks)
   |                    |
   v                    v
 [Next Step] <──── [Retry with visual context]
   |
   v
 [Goal Achieved] ── "Done! Booked a table for 2 at 7 PM."
```

### Under the Hood
- **Content Script** extracts every interactive element on the page — buttons, links, inputs, dropdowns, custom components, shadow DOM elements — ranks them by relevance to your goal, and caps at 300 elements
- **Background Service Worker** builds a prompt with the page state and your goal, calls the LLM, parses the JSON action response, and sends it back to the content script for execution
- **Vision System** captures screenshots, overlays color-coded numbered markers on interactive elements, and sends the annotated image to a vision-capable LLM
- **Anti-Loop Detection** monitors action history for repeated actions, A-B-A oscillation, scroll stagnation, and silent failures — automatically escalates or tries alternative approaches

## Architecture

```
agentic-browser-ext/
├── manifest.json            # Manifest V3, version 1.0.0
├── privacy-policy.html      # Privacy policy, permission justifications, liability disclaimer
├── background/
│   └── background.js        # Agent loop, LLM calls, prompt engineering, vision escalation, research pipeline
├── content/
│   └── content.js           # DOM extraction, element ranking, action execution, SoM overlay
├── sidepanel/
│   ├── sidepanel.html       # UI — chat view, agent log, settings, workflows, personal info, research drawer
│   └── sidepanel.js         # UI logic, provider config, chat-mode toggle, markdown rendering
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

**Zero dependencies. No build step. No remote code. Pure vanilla JS.**

## What Can It Do?

A sample of the built-in task suggestions:

| Category | Examples |
|----------|---------|
| **Navigation** | Open YouTube, Open Instagram, Open Reddit, Open GitHub |
| **Search** | Search Google for latest news, Find flights to Mumbai, Find hotels in Goa |
| **Shopping** | Search Amazon for headphones, Open Flipkart, Order food from Swiggy |
| **Productivity** | Check Gmail inbox, Open Google Calendar, Create a Google Doc |
| **Utilities** | Check today's weather, Convert 100 USD to INR, Cricket live scores |
| **Page Analysis** | Summarize this article, List key points, Explain this page simply |
| **Research** | Research quantum computing, Deep dive into climate change, Investigate any topic |

## Settings

Click the gear icon in the sidebar header:

| Setting | Default | Description |
|---------|---------|-------------|
| Provider | Ollama Cloud | Which LLM to use |
| Max Steps | 20 | Auto-stop after N actions |
| Step Delay | 2000ms | Pause between actions |
| LLM Timeout | 15s | Max wait per LLM call |
| Wall Timeout | 300s | Max total task duration |
| Research Model | gemini-3-flash-preview:cloud | LLM used for research summaries (Ollama Cloud only — falls back to primary model on other providers) |
| Chat Mode | Quick | Default mode for the chat input pill (Quick / Pro) |

## Permissions

WebWright requests only what it needs to run as an agent. Full per-permission justifications (the same wording used in the Chrome Web Store submission) are in [privacy-policy.html](privacy-policy.html).

| Permission | Why |
|------------|-----|
| `activeTab` / `tabs` | Read & interact with the current page when you give the agent a task |
| `scripting` | Inject the content script that extracts page elements and executes actions |
| `storage` | Save settings, personal info, workflows, and reports locally |
| `sidePanel` | Display the WebWright sidebar interface |
| `webNavigation` | Detect SPA navigations so the agent knows when a page has changed |
| `debugger` | Last-resort Tier-4 fallback only — synthesizes raw coordinate clicks when DOM clicks fail. Attached on demand, detached after the action. Never used for network inspection or background activity. |
| `<all_urls>` | Required because **the user**, not the developer, decides which sites the agent visits at runtime. No data is read or sent without an explicit user prompt. |

**No remote code is loaded.** All extension JavaScript is bundled in the published package.

## Privacy & Liability

WebWright stores all your data **locally** on your device. It only sends data to the LLM provider **you** choose and configure. There are no first-party servers, analytics, or telemetry.

The full policy is in [privacy-policy.html](privacy-policy.html). It also contains a **Disclaimer of Liability**:

> WebWright is provided "as is". The developer is **not responsible** for any monetary loss, data loss, account suspension, legal consequences, or any other harm — direct or indirect — that may result from the use or misuse of this extension. The agent acts autonomously on your behalf based on your instructions, so **the user is solely responsible for all actions taken by the agent**, including financial transactions, submitted forms, and compliance with the terms of service of any site visited.
>
> **By installing, enabling, or using WebWright, you acknowledge and agree to these terms in full.** If you do not agree, please uninstall the extension.

## Contributing

Contributions are welcome! Here's how:

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Submit a pull request

## License

MIT

---

<div align="center">

**WebWright ** — Stop browsing. Start commanding.

</div>
