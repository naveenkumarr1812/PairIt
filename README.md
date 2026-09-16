<p align="center">
  <img src="https://raw.githubusercontent.com/naveenkumarr1812/Personal-AI-Router/main/assets/logo.png" alt="PAIR – Personal AI Router" width="480"/>
</p>

<p align="center">
  <strong>Turn your browser AI sessions into a local development interface</strong>
</p>

<p align="center">
  <a href="https://pypi.org/project/personal-ai-router/"><img src="https://img.shields.io/pypi/v/personal-ai-router?color=7C3AED&label=PyPI&style=flat-square" alt="PyPI version"/></a>
  <a href="https://pypi.org/project/personal-ai-router/"><img src="https://img.shields.io/pypi/pyversions/personal-ai-router?color=EA580C&style=flat-square" alt="Python versions"/></a>
  <img src="https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome MV3"/>
  <img src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square" alt="License MIT"/>
</p>

---

## What is PAIR?

**PAIR (Personal AI Router)** is a developer-focused bridge that lets a local Python application talk to AI services — **ChatGPT, Claude, and Gemini** — through the browser tabs you already have open. No API keys, no separate billing; your Python code sends a request, PAIR routes it to the right browser tab, and streams the answer back.

> **Note:** PAIR is intended for local development workflows where the developer is already authenticated with the AI services in their browser.

---

## How It Works

```
Your Python Application
        │
        ▼
    PAIR SDK  (pip install personal-ai-router)
        │
        │  WebSocket
        ▼
  Local PAIR Bridge
        │
        │  Persistent connection
        ▼
  PAIR Chrome Extension
    ┌────┴────┬───────┐
    ▼         ▼       ▼
 ChatGPT   Claude   Gemini
  (tab)    (tab)    (tab)
```

**Design highlights:**

- Your app opens **one** WebSocket connection to the bridge — not a separate connection per provider.
- The extension locates a provider tab only when a request for that provider arrives.
- If the required tab is missing, PAIR returns a clear error:
  `Claude is not open. Open Claude in a Chrome tab and try again.`

---

## Features

| Feature | Details |
|---|---|
| 🔄 **Multi-provider** | ChatGPT, Claude, Gemini — switch with one line |
| 📡 **Streaming** | Real-time browser-side streaming via DOM observer |
| 🔐 **No API keys** | Uses your existing logged-in browser sessions |
| 🪟 **Minimized Chrome** | Bridge stays alive even when Chrome is hidden |
| 🐍 **Python ≥ 3.10** | Async-first, built on `aiohttp` |
| 🧩 **Chrome MV3** | Modern Manifest V3 extension |

---

## Installation

### 1. Install the Python package

```bash
pip install personal-ai-router
```

### 2. Load the Chrome extension

The easiest option is to install PAIR directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/pair/pkcgibncheoddhpfieekkjdffpmmenie).

1. Open the [PAIR Chrome Web Store listing](https://chromewebstore.google.com/detail/pair/pkcgibncheoddhpfieekkjdffpmmenie).
2. Click **Add to Chrome** and confirm the installation.
3. Pin the **PAIR** extension to your toolbar.

---

## Quick Start

### Basic request

```python
from pair import Client

client = Client(provider="chatgpt")

try:
    response = client.chat("Explain async programming in Python")
    print(response.content)
finally:
    client.close()
```

### Streaming

```python
from pair import Client

client = Client(provider="chatgpt")

try:
    for chunk in client.chat("Explain Retrieval-Augmented Generation", stream=True):
        print(chunk.content, end="", flush=True)
    print()
finally:
    client.close()
```

> `stream=False` (default) returns the full response after generation completes.

---

## Developer Workflow

1. **Run** your Python script — the bridge starts automatically.
2. **Open** the required AI provider tabs in Chrome and stay logged in.
3. **Open** the PAIR extension popup and toggle it **ON**.
4. PAIR continuously attempts to connect to the bridge while the toggle is on.
5. **Send** requests from your code — PAIR handles routing.
6. When finished, toggle the extension **OFF**.

> The extension does **not** auto-enable on a new Chrome session. You must turn it on manually to keep control explicit.

---

## Status Model

PAIR tracks two independent states:

| State | Description |
|---|---|
| **Bridge connection** | Local Python app ↔ Chrome extension (WebSocket) |
| **Provider availability** | Whether a ChatGPT / Claude / Gemini tab is currently open |

A provider does **not** need to be permanently connected — it only needs to be open at the moment a request targets it.

---

## Safety & Scope

PAIR is a development-only tool. It **does not**:

- ❌ Extract or store cookies
- ❌ Bypass authentication
- ❌ Circumvent anti-bot protections
- ❌ Automatically switch providers to evade rate limits

---

## Requirements

- Python **≥ 3.10**
- Google Chrome (with the PAIR extension loaded)
- Active browser sessions for the AI providers you intend to use

---

## Contributing

Contributions are welcome! For substantial changes, please open an issue first to discuss the proposed modification.

---

<p align="center">
  Made with ❤️ by PAIR contributors
</p>
