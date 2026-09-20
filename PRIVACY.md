# Privacy Policy for PairIt

**Last updated:** September 20, 2026

PairIt is an open-source browser extension and developer tool designed to bridge local development environments with active browser AI sessions.

Your privacy is paramount. This Privacy Policy details our practices regarding data collection, handling, and security.

---

### 1. Zero Data Collection
* **No Telemetry or Tracking:** PairIt does not collect, track, or record any personally identifiable information (PII), browsing history, analytics, or behavioral data.
* **No External Servers:** PairIt does not operate any remote servers or databases. It does not transmit prompt texts, model responses, or metadata to any third party or to the extension creators.
* **No Account Required:** Using PairIt does not require creating an account or providing email addresses, names, or payment details.

---

### 2. Local-Only Architecture
* All communications occur strictly on your local device (`localhost` / `127.0.0.1:8765`) over a local WebSocket connection between your local Python application and the PairIt browser extension.
* Neither the extension nor the Python library logs, caches, or stores chat conversations or prompts to disk.

---

### 3. Permissions Justification
* **`tabs`:** Used solely to inspect open tabs and detect whether supported AI provider tabs (ChatGPT, Claude, Gemini) are available when requested by your local code.
* **`scripting`:** Used to attach DOM observers to read generated streaming tokens from open provider tabs and return them to your local Python process.
* **`debugger`:** Used strictly to dispatch synthetic keyboard input events into the prompt textarea of the target AI provider tab.
* **`storage`:** Used exclusively to remember the local toggle state (ON or OFF) of the extension popup on your device.
* **`alarms`:** Used to prevent the background service worker from entering sleep mode during extended streaming generation.
* **Host Permissions:** Restricted strictly to `http://127.0.0.1:8765/*` (local bridge) and official AI provider web applications (`chatgpt.com`, `claude.ai`, `gemini.google.com`).

---

### 4. Third-Party Services
When using PairIt to interact with AI services (such as OpenAI's ChatGPT, Anthropic's Claude, or Google's Gemini), your usage remains subject to the respective terms and privacy policies of those independent providers. PairIt does not bypass, intercept, or modify their authentication or security mechanisms.

---

### 5. Open Source Transparency
PairIt is open-source under the MIT License. You can review the complete source code at any time:  
[https://github.com/naveenkumarr1812/pairit](https://github.com/naveenkumarr1812/pairit)

---

### 6. Contact
If you have any questions or feedback regarding this Privacy Policy, please open an issue on GitHub:  
[https://github.com/naveenkumarr1812/pairit/issues](https://github.com/naveenkumarr1812/pairit/issues)
