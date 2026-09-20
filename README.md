<p align="center">
  <img src="https://raw.githubusercontent.com/naveenkumarr1812/PairIt/main/assets/logo.png" alt="PairIt – Your Code. Your Browser. Your AI." width="600"/>
</p>

<p align="center">
  <strong>PairIt – Your Code. Your Browser. Your AI.</strong>
</p>

<p align="center">
  <a href="https://pypi.org/project/pairit/"><img src="https://img.shields.io/badge/PyPI-v0.4.1-7C3AED?style=flat-square" alt="PyPI version"/></a>
  <a href="https://pypi.org/project/pairit/"><img src="https://img.shields.io/badge/python-≥%203.10-EA580C?style=flat-square" alt="Python versions"/></a>
  <img src="https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome MV3"/>
  <img src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square" alt="License MIT"/>
</p>

---

## What is PairIt?

**PairIt** is a developer-focused bridge that lets a local Python application talk to supported AI browser sessions through the tabs you already have open. No API keys, no separate billing; your Python code sends a request, PairIt routes it to the right browser tab, and streams the answer back.

> **Note:** PairIt is intended for local development workflows where the developer is already authenticated with the AI services in their browser.

---

## How It Works

```
Your Python Application
        │
        ▼
    pairit SDK  (pip install pairit)
        │
        │  WebSocket
        ▼
  Local pairit Bridge
        │
        │  Persistent connection
        ▼
  PairIt Chrome Extension
    ┌────┴────┬───────┐
    ▼         ▼       ▼
 ChatGPT   Claude   Gemini
  (tab)    (tab)    (tab)
```

**Design highlights:**

- Your app opens **one** WebSocket connection to the bridge — not a separate connection per provider.
- The extension locates a provider tab only when a request for that provider arrives.
- If the required tab is missing, PairIt returns a clear error:
  `Provider is not open. Open the AI session in a Chrome tab and try again.`

---

## Features

| Feature | Details |
|---|---|
| 🔄 **Multi-provider** | Switch between supported AI providers with one line |
| 📡 **Streaming** | Real-time browser-side streaming via DOM observer |
| 🔐 **No API keys** | Uses your existing logged-in browser sessions |
| 🪟 **Minimized Chrome** | Bridge stays alive even when Chrome is hidden |
| 🐍 **Python ≥ 3.10** | Async-first, built on `aiohttp` |
| 🧩 **Chrome MV3** | Modern Manifest V3 extension |

---

## Installation

### 1. Install the Python package

```bash
pip install pairit
```

### 2. Load the Chrome extension

The easiest option is to install PairIt directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/pair/pkcgibncheoddhpfieekkjdffpmmenie).

1. Open the [Chrome Web Store listing](https://chromewebstore.google.com/detail/pair/pkcgibncheoddhpfieekkjdffpmmenie).
2. Click **Add to Chrome** and confirm the installation.
3. Pin the **PairIt** extension to your toolbar.

---

## Quick Start

### Basic request

```python
from pairit import Client

client = Client()

try:
    response = client.chat("Explain async programming in Python")
    print(response.content)
finally:
    client.close()
```

### Streaming

```python
from pairit import Client

client = Client()

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
3. **Open** the PairIt extension popup and toggle it **ON**.
4. PairIt continuously attempts to connect to the bridge while the toggle is on.
5. **Send** requests from your code — pairit handles routing.
6. When finished, toggle the extension **OFF**.

> The extension does **not** auto-enable on a new Chrome session. You must turn it on manually to keep control explicit.

---

## Status Model

PairIt tracks two independent states:

| State | Description |
|---|---|
| **Bridge connection** | Local Python app ↔ Chrome extension (WebSocket) |
| **Provider availability** | Whether the target AI session tab is currently open |

A provider does **not** need to be permanently connected — it only needs to be open at the moment a request targets it.

---

## Safety & Scope

PairIt is a development-only tool. It **does not**:

- ❌ Extract or store cookies
- ❌ Bypass authentication
- ❌ Circumvent anti-bot protections
- ❌ Automatically switch providers to evade rate limits

---

## Requirements

- Python **≥ 3.10**
- Google Chrome (with the PairIt extension loaded)
- Active browser sessions for the AI providers you intend to use

---

## Contributing

Contributions are welcome! For substantial changes, please open an issue first to discuss the proposed modification.

---

<p align="center">
  Made with ❤️ by PairIt contributors
</p>
