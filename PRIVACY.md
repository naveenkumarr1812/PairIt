# PairIt Privacy Policy

**Last updated:** October 5, 2026

PairIt is an open-source Python SDK and Chrome extension that connects a local application to browser AI sessions and supported models running in Chrome. This policy describes what PairIt stores, what it sends, and what the Chrome extension permissions are used for.

## Summary

- PairIt does not operate a PairIt cloud service or collect analytics, advertising identifiers, browsing history, prompts, or model responses.
- The Python SDK and extension communicate over `127.0.0.1:8765` on the same device.
- Browser-session requests are sent to the provider website that you choose, using the browser session already open there.
- Local model files are downloaded from the pinned Hugging Face URLs in the extension registry and then cached locally by Chrome.
- Local model inference runs in Chrome using WebGPU or WASM. PairIt does not send those inference inputs to a PairIt server.

## Data handling

### Local bridge

The Python SDK starts a local HTTP/WebSocket bridge bound by default to `127.0.0.1:8765`. It forwards requests between the SDK and the extension. The bridge keeps in-memory request state while a request is active and does not intentionally persist prompts, images, responses, or credentials to disk.

You can configure the bind host and port when creating `Client`, but exposing the bridge beyond loopback is outside the default security model and should only be done in a controlled environment.

### Browser sessions

When you use `chatgpt`, `claude`, or `gemini`, PairIt locates a supported provider tab and injects the provider-specific request/response handling needed to submit a prompt and read the generated response. The request and response are handled by that provider's website and remain subject to its terms, privacy policy, account settings, and retention practices.

PairIt does not export cookies, passwords, authentication tokens, or session credentials.

### Local models

The extension downloads model artifacts from the exact URLs and revisions listed in `extension/stateless/registry/models.json`. Before an artifact is accepted, its SHA-256 checksum is verified against the registry.

Chrome stores local model artifacts in the Cache API and model metadata/state in IndexedDB. The extension also uses Chrome session storage for the temporary enabled/disabled bridge state. You can remove installed models from the popup; clearing the extension's site data also removes its local storage.

After download, stateless chat, vision, and embedding operations execute inside the extension's offscreen worker. The model input and output are sent between the local Python process and the local extension bridge, not to a PairIt cloud endpoint.

### Diagnostics

PairIt may write operational messages to the local Python/Chrome developer console to help diagnose connection, provider, download, or runtime failures. It does not send those logs to PairIt servers.

## Chrome permissions

The extension requests the following permissions:

| Permission | Purpose |
| --- | --- |
| `tabs` | Find supported ChatGPT, Claude, and Gemini tabs, create provider tabs from the popup, and track tab lifecycle. |
| `scripting` | Inject the provider-specific request and response handlers into supported provider tabs. |
| `debugger` | Keep a provider page active while a request is running, including when Chrome is minimized, and dispatch the required browser lifecycle commands. |
| `alarms` | Reconnect the local bridge and keep long model downloads or streaming operations alive while Chrome's service worker is idle. |
| `storage` | Use Chrome session storage for temporary extension state. Model metadata is stored separately in IndexedDB. |
| `offscreen` | Run the local model worker in an offscreen document. |
| `sidePanel` | Make the same popup UI available as a Chrome side panel. |

Host access is limited to the local bridge, the supported provider sites, and Hugging Face hosts used for pinned model downloads. The extension does not request broad arbitrary website access.

## Third-party services

PairIt is not affiliated with OpenAI, Anthropic, Google, or Hugging Face. When you use those services, their own privacy policies and terms apply. Hugging Face is contacted for first-time model downloads; subsequent inference uses the locally cached artifacts unless you remove them.

## Security boundaries

The default bridge is loopback-only, but a local web page or local process on the same machine may be able to attempt connections to a loopback service. Do not bind the bridge to a network-facing interface unless you add appropriate network controls. Keep the extension enabled only while you intend to use the bridge.

## Open source and contact

The source code is available at [github.com/naveenkumarr1812/PairIt](https://github.com/naveenkumarr1812/PairIt). For questions or privacy concerns, open an issue at [github.com/naveenkumarr1812/PairIt/issues](https://github.com/naveenkumarr1812/PairIt/issues).
