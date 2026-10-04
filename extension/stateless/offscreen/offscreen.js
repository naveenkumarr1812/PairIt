/**
 * PairIt Offscreen Host
 *
 * Runs inside the Manifest V3 Offscreen Document.
 * Hosts the dedicated Web Worker, proxies messages to/from background service worker,
 * and recovers gracefully if the worker encounters an unrecoverable failure.
 */

let modelWorker = null;
let pendingRequests = new Map(); // requestId -> { resolve, reject, timeoutId }

function createWorker() {
  if (modelWorker) {
    try {
      modelWorker.terminate();
    } catch (_) {}
  }

  const workerUrl = chrome.runtime.getURL("stateless/dist/model-worker.bundle.js");
  modelWorker = new Worker(workerUrl);

  modelWorker.onmessage = (event) => {
    const data = event.data || {};
    const { type, requestId } = data;

    if (requestId && pendingRequests.has(requestId)) {
      const { resolve } = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);
      resolve(data);
    } else {
      // Broadcast other messages back to background if needed
      chrome.runtime.sendMessage({
        target: "background",
        ...data,
      }).catch(() => {});
    }
  };

  modelWorker.onerror = (error) => {
    console.error("[PairIt Offscreen] Worker error:", error);
    // Reject all pending requests with a runtime crash error
    for (const [reqId, { resolve }] of pendingRequests.entries()) {
      resolve({
        type: "model_error",
        requestId: reqId,
        code: "model_runtime_crash",
        message: `Model worker encountered an unexpected error: ${error?.message || "Worker crashed"}`,
      });
    }
    pendingRequests.clear();

    // Recreate worker
    createWorker();
  };
}

// Initialize worker on load
createWorker();

// Listen for messages from background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return false;
  }

  const { type, requestId } = message;

  if (type === "ping") {
    sendResponse({ ok: true, pong: true });
    return false;
  }

  if (type === "detect_backend") {
    // Check WebGPU in offscreen window
    const hasWebGPU = Boolean(navigator.gpu);
    sendResponse({
      webgpu: hasWebGPU,
      device: hasWebGPU ? "webgpu" : "wasm",
    });
    return false;
  }

  if (type === "model_request" || type === "unload_model") {
    if (!modelWorker) {
      createWorker();
    }

    const reqId = requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    message.requestId = reqId;

    pendingRequests.set(reqId, {
      resolve: (result) => {
        sendResponse(result);
      },
    });

    modelWorker.postMessage(message);
    return true; // Keep message channel open for async response
  }

  return false;
});
