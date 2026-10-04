/**
 * RuntimeManager
 *
 * Background Service Worker controller for the MV3 Offscreen runtime.
 * Ensures the offscreen document is running, relays model inference requests,
 * and maintains worker health.
 */

const OFFSCREEN_PATH = "stateless/offscreen/offscreen.html";

var RuntimeManager = class RuntimeManager {
  constructor() {
    this.creatingDocument = null;
  }

  async ensureOffscreenDocument() {
    if (typeof chrome === "undefined" || !chrome.offscreen) {
      return;
    }

    // Check if offscreen document already exists
    if (chrome.offscreen.hasDocument) {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) {
        return;
      }
    } else {
      // In older Chrome versions, query clients
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
      });
      if (existingContexts.length > 0) {
        return;
      }
    }

    if (this.creatingDocument) {
      await this.creatingDocument;
      return;
    }

    this.creatingDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["WORKERS"],
      justification: "Run local ML model inference in a dedicated Web Worker",
    });

    try {
      await this.creatingDocument;
    } finally {
      this.creatingDocument = null;
    }
  }

  async sendModelRequest(requestId, modelSpec, operation, payload) {
    await this.ensureOffscreenDocument();

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          target: "offscreen",
          type: "model_request",
          requestId,
          modelSpec,
          operation,
          payload,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!response) {
            return reject(new Error("No response received from model runtime"));
          }
          resolve(response);
        }
      );
    });
  }

  async unloadModel(modelId) {
    if (typeof chrome === "undefined" || !chrome.offscreen) {
      return;
    }
    try {
      await this.ensureOffscreenDocument();
      const requestId = `unload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            target: "offscreen",
            type: "unload_model",
            requestId,
            modelId,
          },
          () => resolve()
        );
      });
    } catch (_) {}
  }

  async detectBackend() {
    if (typeof chrome === "undefined" || !chrome.offscreen) {
      return { webgpu: false, device: "wasm" };
    }
    try {
      await this.ensureOffscreenDocument();
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            target: "offscreen",
            type: "detect_backend",
          },
          (response) => {
            if (response && response.webgpu !== undefined) {
              resolve(response);
            } else {
              resolve({ webgpu: false, device: "wasm" });
            }
          }
        );
      });
    } catch (_) {
      return { webgpu: false, device: "wasm" };
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RuntimeManager };
} else if (typeof globalThis !== "undefined") {
  globalThis.RuntimeManager = RuntimeManager;
}
