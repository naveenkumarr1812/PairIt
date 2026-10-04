/**
 * ModelDownloader
 *
 * Manages clean, direct artifact downloads for PairIt Stateless Models.
 * - Immediate abort & instant cancellation cleanup
 * - Zero-delay deletion and progress reset
 * - Smooth, steady progress broadcasting
 */

var _MODEL_STATES = typeof MODEL_STATES !== "undefined"
  ? MODEL_STATES
  : (typeof require !== "undefined" ? require("../storage/model-storage.js").MODEL_STATES : (globalThis.MODEL_STATES || {}));

var ModelDownloader = class ModelDownloader {
  constructor(registry, storage, onProgressCallback = null) {
    this.registry = registry;
    this.storage = storage;
    this.onProgress = onProgressCallback;
    this.activeDownloads = new Map(); // modelId -> { controller: AbortController, promise: Promise, progress: object }
  }

  isDownloading(modelId) {
    return this.activeDownloads.has(modelId);
  }

  getProgress(modelId) {
    const active = this.activeDownloads.get(modelId);
    return active ? active.progress : null;
  }

  async downloadModel(modelId) {
    if (this.activeDownloads.has(modelId)) {
      return this.activeDownloads.get(modelId).promise;
    }

    const model = this.registry.getModel(modelId);
    if (!model) {
      throw new Error(`Model '${modelId}' not found in registry.`);
    }

    const controller = new AbortController();
    const downloadPromise = this._executeDownload(model, controller.signal);
    const totalBytes = model.artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);

    this.activeDownloads.set(modelId, {
      controller,
      promise: downloadPromise,
      progress: {
        status: _MODEL_STATES.DOWNLOADING,
        downloadedBytes: 0,
        totalBytes,
        percent: 0,
        currentArtifact: "",
      },
    });

    try {
      const result = await downloadPromise;
      return result;
    } finally {
      this.activeDownloads.delete(modelId);
    }
  }

  async cancelDownload(modelId) {
    const active = this.activeDownloads.get(modelId);
    if (active) {
      try {
        active.controller.abort();
      } catch (_) {}
      this.activeDownloads.delete(modelId);
    }

    const model = this.registry.getModel(modelId);
    const urls = model ? model.artifacts.map((a) => a.url) : [];
    try {
      await this.storage.deleteModel(modelId, urls);
    } catch (_) {}

    this._notifyProgress(modelId, {
      status: _MODEL_STATES.NOT_INSTALLED,
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
    });
    return true;
  }

  async _executeDownload(model, signal) {
    const modelId = model.id;
    const totalBytes = model.artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);

    // 1. Mark State: DOWNLOADING
    await this.storage.markInstalling(modelId, model.source.revision, totalBytes);
    this._notifyProgress(modelId, {
      status: _MODEL_STATES.DOWNLOADING,
      downloadedBytes: 0,
      totalBytes,
      percent: 0,
      currentArtifact: "",
    });

    let overallDownloaded = 0;
    const verifiedArtifacts = [];

    // 2. Download artifacts sequentially
    for (let i = 0; i < model.artifacts.length; i++) {
      if (signal.aborted) {
        throw new Error("Download aborted.");
      }

      const artifact = model.artifacts[i];
      const artifactLabel = `${artifact.path} (${i + 1}/${model.artifacts.length})`;

      // Fetch artifact directly with progress
      const baseDownloaded = overallDownloaded;
      const buffer = await this._fetchDirect(artifact.url, signal, (fileBytesReceived) => {
        const currentOverall = baseDownloaded + fileBytesReceived;
        const currentPct = Math.min(99, Math.round((currentOverall / totalBytes) * 100));
        this._notifyProgress(modelId, {
          status: _MODEL_STATES.DOWNLOADING,
          downloadedBytes: currentOverall,
          totalBytes,
          percent: currentPct,
          currentArtifact: `Downloading ${artifactLabel}`,
        });
      });

      if (signal.aborted) {
        throw new Error("Download aborted.");
      }

      overallDownloaded = baseDownloaded + buffer.byteLength;

      // Commit artifact to cache
      await this.storage.putArtifact(artifact.url, buffer);
      verifiedArtifacts.push(artifact.path);
    }

    if (signal.aborted) {
      throw new Error("Download aborted.");
    }

    // 3. Final State: READY
    await this.storage.markReady(modelId, model.source.revision, totalBytes, verifiedArtifacts);
    this._notifyProgress(modelId, {
      status: _MODEL_STATES.READY,
      downloadedBytes: totalBytes,
      totalBytes,
      percent: 100,
      currentArtifact: "Ready",
    });

    return {
      modelId,
      status: _MODEL_STATES.READY,
      totalBytes,
      verifiedCount: verifiedArtifacts.length,
    };
  }

  async _fetchDirect(url, signal, onProgress) {
    if (signal.aborted) {
      throw new Error("Download aborted.");
    }

    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    let lastNotify = 0;

    while (true) {
      if (signal.aborted) {
        reader.cancel().catch(() => {});
        throw new Error("Download aborted.");
      }

      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      received += value.byteLength;

      const now = Date.now();
      if (onProgress && (now - lastNotify >= 30)) {
        lastNotify = now;
        onProgress(received);
      }
    }

    if (onProgress) {
      onProgress(received);
    }

    // Assemble buffer
    const fullBuffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      fullBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return fullBuffer.buffer;
  }

  _notifyProgress(modelId, data) {
    const active = this.activeDownloads.get(modelId);
    if (active) {
      active.progress = { ...active.progress, ...data };
    }

    if (typeof this.onProgress === "function") {
      try {
        this.onProgress(modelId, data);
      } catch (err) {
        console.error("Error in onProgress callback:", err);
      }
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ModelDownloader };
} else if (typeof globalThis !== "undefined") {
  globalThis.ModelDownloader = ModelDownloader;
}
