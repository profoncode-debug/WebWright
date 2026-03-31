<div align="center">

# WebWright

### Built for action, not just browsing.

An autonomous AI agent that lives in your browser sidebar — it sees web pages, reasons about them, and takes real actions to complete tasks for you.

**Tell it what you want. Watch it work.**

[Install](#installation) | [Features](#features) | [Providers](#supported-providers) | [How It Works](#how-it-works) | [Contributing](#contributing)

</div>

---

## What is WebWright?

WebWright is a Chrome extension that turns your browser into an AI-powered assistant. Instead of just answering questions, it **actually does things** — fills forms, navigates sites, clicks buttons, searches the web, books tickets, and more.

Type a goal like *"Search Amazon for wireless headphones under $50"* and the agent takes over: it navigates to Amazon, types the search query, applies filters, and reports back what it found. All while you watch the real-time action log in the sidebar.

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

### Vision Escalation — 4-Tier Intelligence
When simple DOM reading isn't enough, WebWright automatically escalates:

| Tier | Method | When |
|------|--------|------|
| 1 | **DOM Analysis** | Default — fast, token-efficient |
| 2 | **Vision + 80 Elements** | DOM action fails, element not found, or stuck in loop |
| 3 | **Vision + 160 Elements** | Vision 80 couldn't resolve the issue |
| 4 | **Raw Coordinates** | Last resort — clicks by X,Y position on screenshot |

Each tier adds more visual context. The agent annotates screenshots with color-coded numbered markers (Set-of-Marks) so the LLM can see and understand every interactive element.

### Workflows — Record and Replay
- **Record** your browser actions (clicks, typing, navigation) across tabs
- **Save** them as named workflows
- **Replay** them anytime with one click — with pause/resume controls

### Personal Info Vault
Store your details locally (never sent to any server) for instant form filling:
- Name, Age, Sex, Father's/Mother's Name, Address
- 5 custom fields for anything else (email, phone, etc.)
- Agent uses these **only** when the task involves filling a form

### Smart Suggestions
52 pre-built task suggestions across categories — navigation, shopping, productivity, search, and more. 3 random chips rotate on each session for quick access.

## Supported Providers

WebWright works with **8 LLM providers** out of the box:

| Provider | Default Model | Vision Model | Free Tier |
|----------|--------------|--------------|-----------|
| **Ollama Cloud** | gpt-oss:120b | qwen3.5:397b | Yes |
| **Ollama Local** | qwen2.5-coder:7b | llava:13b | Yes (self-hosted) |
| **OpenAI** | gpt-4o | gpt-4o | No |
| **Claude** | claude-sonnet-4 | claude-sonnet-4 | No |
| **Gemini** | gemini-2.0-flash | gemini-2.0-flash | Yes |
| **DeepSeek** | deepseek-chat | — | Yes |
| **Grok** | grok-3-mini | — | No |
| **Custom** | User-defined | User-defined | Depends |

Bring your own API key — or run fully local with Ollama.

## Installation

1. Clone this repo:
   ```bash
   git clone https://github.com/ArijeetProfOnCode/webwright.git
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `agentic-browser-ext` folder
5. Pin the extension to your toolbar

## Quick Start

### Run a Task
1. Click the WebWright icon to open the sidebar
2. Type a goal: *"Open YouTube and search for lofi music"*
3. Press **Ctrl+Enter** (or click the play button)
4. Watch the agent work in real-time

### Chat About a Page
1. Navigate to any article or webpage
2. Open the sidebar and type: *"Summarize this page"*
3. Press **Enter** (or click the chat button)

### Fill a Form
1. Open the **Personal Info** drawer (person icon in header) and save your details
2. Navigate to any form page
3. Type: *"Fill out this form with my info"*
4. The agent reads your saved data and fills every field

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
├── manifest.json            # Chrome Extension Manifest V3
├── background/
│   └── background.js        # Agent loop, LLM calls, prompt engineering, vision escalation
├── content/
│   └── content.js           # DOM extraction, element ranking, action execution, SoM overlay
├── sidepanel/
│   ├── sidepanel.html       # UI — chat view, agent log, settings, workflows, personal info
│   └── sidepanel.js         # UI logic, provider config, markdown rendering
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

**Zero dependencies. No build step. Pure vanilla JS.**

## What Can It Do?

Here's a sample of the 52+ built-in task suggestions:

| Category | Examples |
|----------|---------|
| **Navigation** | Open YouTube, Open Instagram Reels, Go to Reddit |
| **Search** | Search Google for latest news, Find flights Delhi to Tokyo |
| **Shopping** | Search Amazon for headphones, Compare laptop prices |
| **Productivity** | Check Gmail inbox, Open Google Calendar, Create a Google Doc |
| **Social** | Post a tweet, Check Instagram DMs, Subscribe to a channel |
| **Forms** | Fill out this form, Register an account, Complete checkout |
| **Info** | Check today's weather, Show cricket live scores, Currency conversion |
| **Page Analysis** | Summarize this article, List key points, Explain this page simply |

## Settings

Click the gear icon in the sidebar header:

| Setting | Default | Description |
|---------|---------|-------------|
| Provider | Ollama Cloud | Which LLM to use |
| Max Steps | 20 | Auto-stop after N actions |
| Step Delay | 2000ms | Pause between actions |
| LLM Timeout | 15s | Max wait per LLM call |
| Wall Timeout | 300s | Max total task duration |

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

**WebWright** — Stop browsing. Start commanding.

</div>
