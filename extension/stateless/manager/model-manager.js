/**
 * ModelManager
 *
 * Central coordinator for Stateless Models in PairIt:
 * - Registry lookup & capability checking
 * - Storage state inspection & cleanup
 * - Download orchestration
 * - Model deletion & cache clearing
 */

var _ModelRegistry = typeof ModelRegistry !== "undefined"
  ? ModelRegistry
  : (typeof require !== "undefined" ? require("../registry/model-registry.js").ModelRegistry : (globalThis.ModelRegistry || null));

var _ModelStorage = typeof ModelStorage !== "undefined"
  ? ModelStorage
  : (typeof require !== "undefined" ? require("../storage/model-storage.js").ModelStorage : (globalThis.ModelStorage || null));

var _MODEL_STATES = typeof MODEL_STATES !== "undefined"
  ? MODEL_STATES
  : (typeof require !== "undefined" ? require("../storage/model-storage.js").MODEL_STATES : (globalThis.MODEL_STATES || null));

var _ModelDownloader = typeof ModelDownloader !== "undefined"
  ? ModelDownloader
  : (typeof require !== "undefined" ? require("../downloader/model-downloader.js").ModelDownloader : (globalThis.ModelDownloader || null));

var ModelManager = class ModelManager {
  constructor(registryData = null, onProgress = null) {
    this.registry = new _ModelRegistry(registryData);
    this.storage = new _ModelStorage();
    this.downloader = new _ModelDownloader(this.registry, this.storage, onProgress);
    this.onProgress = onProgress;
  }

  async initialize(registryData = null) {
    if (registryData) {
      this.registry.load(registryData);
    }
    await this.storage.initialize();
  }

  getRegistry() {
    return this.registry;
  }

  getModelSpec(modelId) {
    return this.registry.getModel(modelId);
  }

  listModels() {
    return this.registry.listModels();
  }

  async getModelStatus(modelId) {
    const spec = this.registry.getModel(modelId);
    if (!spec) {
      return {
        id: modelId,
        status: "UNKNOWN_MODEL",
        downloaded: false,
        ready: false,
      };
    }

    const storageStatus = await this.storage.getModelStatus(modelId);
    const isDownloading = this.downloader.isDownloading(modelId);
    const activeProgress = isDownloading ? this.downloader.getProgress(modelId) : null;

    const downloadedBytes = activeProgress ? activeProgress.downloadedBytes : storageStatus.downloadedBytes;
    const progress = activeProgress ? activeProgress.percent : storageStatus.progress;
    const status = isDownloading ? (activeProgress?.status || _MODEL_STATES.DOWNLOADING) : storageStatus.status;

    return {
      id: modelId,
      displayName: spec.displayName,
      category: spec.category,
      capabilities: spec.capabilities,
      license: spec.license.name,
      description: spec.description,
      runtime: spec.runtime,
      totalBytes: storageStatus.totalBytes || spec.artifacts.reduce((s, a) => s + a.sizeBytes, 0),
      downloadedBytes,
      progress,
      status,
      downloaded: storageStatus.status === _MODEL_STATES.READY,
      ready: storageStatus.status === _MODEL_STATES.READY,
      error: storageStatus.error,
      installedAt: storageStatus.installedAt,
      revision: storageStatus.revision,
    };
  }

  async listAllModelsWithStatus() {
    const models = this.registry.listModels();
    const result = [];
    for (const m of models) {
      const status = await this.getModelStatus(m.id);
      result.push(status);
    }
    return result;
  }

  async listInstalledModels() {
    const all = await this.listAllModelsWithStatus();
    return all.filter((m) => m.ready);
  }

  async isModelReady(modelId) {
    const spec = this.registry.getModel(modelId);
    if (!spec) {
      return false;
    }
    return this.storage.exists(modelId);
  }

  async downloadModel(modelId) {
    const spec = this.registry.getModel(modelId);
    if (!spec) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    return this.downloader.downloadModel(modelId);
  }

  async cancelDownload(modelId) {
    return this.downloader.cancelDownload(modelId);
  }

  async deleteModel(modelId, runtimeUnloadCallback = null) {
    const spec = this.registry.getModel(modelId);
    if (!spec) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    // 1. Unload from runtime memory if loaded
    if (typeof runtimeUnloadCallback === "function") {
      try {
        await runtimeUnloadCallback(modelId);
      } catch (err) {
        console.warn(`Error unloading model ${modelId} prior to deletion:`, err);
      }
    }

    // 2. Abort active download if any
    await this.cancelDownload(modelId);

    // 3. Remove all artifacts and metadata
    const artifactUrls = spec.artifacts.map((a) => a.url);
    await this.storage.deleteModel(modelId, artifactUrls);

    // 4. Notify progress
    if (typeof this.onProgress === "function") {
      this.onProgress(modelId, {
        status: _MODEL_STATES.NOT_INSTALLED,
        downloadedBytes: 0,
        totalBytes: 0,
        percent: 0,
      });
    }

    return true;
  }

  async getStorageInfo() {
    const usage = await this.storage.getStorageUsage();
    const installed = await this.listInstalledModels();
    return {
      ...usage,
      installedCount: installed.length,
      installedModels: installed,
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ModelManager };
} else if (typeof globalThis !== "undefined") {
  globalThis.ModelManager = ModelManager;
}
