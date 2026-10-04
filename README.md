<p align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/naveenkumarr1812/PairIt/main/assets/dark-mode.png">
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/naveenkumarr1812/PairIt/main/assets/light-mode.png">
        <img src="https://raw.githubusercontent.com/naveenkumarr1812/PairIt/main/assets/light-mode.png" alt="PairIt – Your Code. Your Browser. Your AI." width="600">
    </picture>
</p>

<p align="center">
  <strong>PairIt – Your Code. Your Browser. Your AI.</strong>
</p>

<p align="center">
    <a href="https://pypi.org/project/pairit/"><img src="https://img.shields.io/badge/PyPI-v0.5.0-7C3AED?style=flat-square" alt="PyPI version"/></a>
  <a href="https://pypi.org/project/pairit/"><img src="https://img.shields.io/badge/python-≥%203.10-EA580C?style=flat-square" alt="Python versions"/></a>
  <img src="https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome MV3"/>
  <img src="https://img.shields.io/badge/license-MIT-22C55E?style=flat-square" alt="License MIT"/>
</p>

---

## What is PairIt?

**PairIt** is a developer-focused bridge that lets local Python applications communicate with AI models through your browser. It provides **one unified developer-facing API** for two distinct categories of models:

1. **Stateful Models (Browser AI Sessions)**: Connects directly to your already-authenticated ChatGPT, Claude, or Gemini browser tabs. No PairIt API key is required; the provider's own terms and account policies still apply.
2. **Stateless Models (Local In-Browser Inference)**: Runs supported open-source models inside your browser via WebGPU and ONNX Runtime / WASM. PairIt does not collect telemetry, and inference runs locally after the model files are downloaded.

---

## Unified Developer API

Whether interacting with a remote browser AI session or a local on-device model, the Python API is unified:

```python
from pairit import Client

# Stateful model (browser session)
client = Client("chatgpt")  # or "claude", "gemini"

# Stateless models (local WebGPU/WASM inference)
client = Client("qwen3-0.6b")                # Local LLM Chat
client = Client("smollm2-360m")              # Local SmolLM2 Chat
client = Client("qwen2.5-coder-0.5b")        # Local Code & Chat LLM
client = Client("smolvlm-500m")               # Local Vision Language Model
client = Client("moondream2")                 # Local Moondream2 Vision Model
client = Client("vit-gpt2-image-captioning")  # Local ViT-GPT2 Captioner
client = Client("all-minilm-l6-v2")           # Local Sentence Embeddings
client = Client("bge-small-en-v1.5")          # Local BGE Small Embeddings
```

---

## Supported Models

| Category | Model Name | Capability | Description / Engine |
|---|---|---|---|
| **Stateful** | `chatgpt` | `chat()` | Existing browser tab session on chatgpt.com |
| **Stateful** | `claude` | `chat()` | Existing browser tab session on claude.ai |
| **Stateful** | `gemini` | `chat()` | Existing browser tab session on gemini.google.com |
| **Stateless** | `qwen3-0.6b` | `chat()` | Local 0.6B instruction-tuned LLM (WebGPU / WASM) |
| **Stateless** | `smollm2-135m` | `chat()` | Local 135M chat LLM (WebGPU / WASM) |
| **Stateless** | `smollm2-360m` | `chat()` | Local 360M state-of-the-art chat model by Hugging Face (WebGPU / WASM) |
| **Stateless** | `qwen2.5-coder-0.5b` | `chat()` | Local 0.5B coding & technical chat model (WebGPU / WASM) |
| **Stateless** | `smolvlm-500m` | `vision()` | Local high-quality multimodal vision-language model (WebGPU / WASM) |
| **Stateless** | `moondream2` | `vision()` | Local 0.5B Moondream2 multimodal visual QA model (WebGPU / WASM) |
| **Stateless** | `vit-gpt2-image-captioning` | `vision()` | Local Vision Transformer + GPT-2 image captioning model (WebGPU / WASM) |
| **Stateless** | `trocr-small-printed` | `vision()` | Local printed-text recognition model (WebGPU / WASM) |
| **Stateless** | `all-minilm-l6-v2` | `embed()` | Local 384-dimensional dense sentence embeddings (WebGPU / WASM) |
| **Stateless** | `bge-small-en-v1.5` | `embed()` | Local 384-dimensional BAAI BGE small embeddings (WebGPU / WASM) |
| **Stateless** | `gte-small` | `embed()` | Local dense sentence embeddings (WebGPU / WASM) |
| **Stateless** | `multilingual-e5-small` | `embed()` | Local multilingual sentence embeddings (WebGPU / WASM) |

---

## Architecture

```
Your Python Application
        │
        ▼
   pairit SDK  (pip install pairit)
        │
        │  WebSocket (127.0.0.1:8765)
        ▼
   Local pairit Bridge
        │
        │  Persistent connection
        ▼
   PairIt Chrome Extension (MV3)
   ┌───────────────────────┴───────────────────────┐
   ▼                                               ▼
[Stateful Routing]                       [Stateless Engine]
Chrome Tabs (DOM automation)              Offscreen Document + Worker
  ├── ChatGPT (tab)                        ├── Model Storage (IndexedDB + Cache API)
  ├── Claude (tab)                         ├── Hugging Face Transformers.js runtime
  └── Gemini (tab)                         └── ONNX Runtime WebGPU / WASM backend
```

---

## Installation

### 1. Install the Python package

```bash
pip install pairit
```

### 2. Load the Chrome extension

Install PairIt from the [Chrome Web Store](https://chromewebstore.google.com/detail/pair/pkcgibncheoddhpfieekkjdffpmmenie), or load unpacked from the `extension` directory for local development:

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `extension/` folder.
4. Pin the **PairIt** extension to your toolbar.

---

## Usage Examples

### 1. Stateful Browser Session (ChatGPT, Claude, Gemini)

```python
from pairit import Client

# Use Client("claude") or Client("gemini") for another browser session.
client = Client("chatgpt")

try:
    response = client.chat("Explain async programming in Python")
    print(response.content)
finally:
    client.close()
```

#### Streaming responses:

```python
from pairit import Client

client = Client("chatgpt")

try:
    for chunk in client.chat("Explain Retrieval-Augmented Generation", stream=True):
        print(chunk.content, end="", flush=True)
    print()
finally:
    client.close()
```

---

### 2. Local LLM Chat (Stateless)

Download `qwen3-0.6b` via the PairIt extension popup, then execute inference locally:

```python
from pairit import Client

client = Client("qwen3-0.6b")

try:
    response = client.chat("What are the advantages of local AI models?")
    print(response.content)
    print(f"Computed on: {response.backend}")  # 'webgpu' or 'wasm'
finally:
    client.close()
```

Stateless models do not retain chat history on their own, but you can pass conversation history explicitly:

```python
response = client.chat_messages([
    {"role": "user", "content": "Hello! My name is Alice."},
    {"role": "assistant", "content": "Hi Alice! How can I help you today?"},
    {"role": "user", "content": "What is my name?"}
])
print(response.content)
```

---

### 3. Local Dense Embeddings (Stateless)

Extract dense vector representations without sending private data over the network:

```python
from pairit import Client

client = Client("all-minilm-l6-v2")

try:
    # Single string or list of strings
    result = client.embed(["Semantic search query", "Relevant document passage"])
    print(f"Dimensions: {result.dimensions}")  # 384
    print(f"Vectors generated: {len(result.vectors)}")
    print(f"Vector preview: {result.vectors[0][:5]}...")
finally:
    client.close()
```

---

### 4. Local Vision-Language Processing (Stateless)

Send an image along with a prompt to a local vision model:

```python
from pairit import Client

client = Client("smolvlm-500m")

try:
    # Supports file path, bytes, or data URLs
    response = client.vision("screenshot.png", prompt="Describe the UI elements in this image.")
    print(response.content)
finally:
    client.close()
```

---

## Managing Stateless Models

Open the PairIt Chrome extension popup:

1. **Model Catalog**: View available models, category tags (LLM, Embedding, Vision), and size requirements.
2. **One-Click Download**: Download model artifacts directly from Hugging Face into the browser Cache API.
3. **Integrity & Verification**: Every artifact is cryptographically verified with SHA-256 checksums before marking ready.
4. **Storage Management**: View storage consumption and delete downloaded models to free disk space at any time.
5. **Hardware Acceleration**: Automatically detects WebGPU acceleration and falls back to WASM/SIMD when WebGPU is unsupported.

---

## Error Handling

PairIt provides structured exceptions for clean error management:

```python
from pairit import Client
from pairit.exceptions import (
    UnknownModelError,
    ModelNotDownloadedError,
    UnsupportedOperationError,
    ExtensionNotConnectedError,
)

try:
    client = Client("qwen3-0.6b")
    response = client.chat("Hello!")
except ModelNotDownloadedError:
    print("Please open the PairIt extension popup and download 'qwen3-0.6b' first.")
except ExtensionNotConnectedError:
    print("Please ensure Google Chrome is running and the PairIt extension is toggled ON.")
except UnsupportedOperationError as e:
    print(f"Invalid operation for this model: {e}")
```

---

## Safety, Privacy & Scope

- 🔒 **Zero Telemetry for Stateless Models**: All stateless inference executes inside your local Chrome browser process. No prompts, images, or embeddings leave your machine.
- ❌ **No Credential Access**: PairIt does not access or export session cookies, credentials, or authentication tokens.
- 🛡️ **Integrity Verification**: All downloaded artifacts are verified against pinned SHA-256 checksums.

---

## Requirements

- Python **≥ 3.10**
- Google Chrome (with the PairIt extension loaded)
- For Stateful Models: Logged-in session tab in Chrome (`chatgpt.com`, `claude.ai`, or `gemini.google.com`)
- For Stateless Models: Chrome with WebGPU or WASM support

---

## Contributing

Contributions are welcome! For substantial changes, please open an issue first to discuss the proposed modification.

---

<p align="center">
  Made with ❤️ by PairIt contributors
</p>
