/**
 * ModelStorage
 *
 * Persistent storage abstraction for PairIt Stateless Models.
 * - Model metadata and state machine stored in IndexedDB ('pairit_model_storage_v1')
 * - Binary model artifacts stored in browser Cache API ('pairit-models-v1')
 * - Storage quota inspection via navigator.storage.estimate()
 */

var MODEL_STATES = globalThis.MODEL_STATES || {
  NOT_INSTALLED: "NOT_INSTALLED",
  CHECKING: "CHECKING",
  DOWNLOADING: "DOWNLOADING",
  VERIFYING: "VERIFYING",
  INSTALLING: "INSTALLING",
  READY: "READY",
  FAILED: "FAILED",
  DELETING: "DELETING",
  UPDATE_AVAILABLE: "UPDATE_AVAILABLE",
};

const DB_NAME = "pairit_model_storage_v1";
const DB_VERSION = 1;
const METADATA_STORE = "model_metadata";
const CACHE_NAME = "pairit-models-v1";

var ModelStorage = class ModelStorage {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  async initialize() {
    if (this.db) {
      return this.db;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      // In node environments without indexedDB, use in-memory fallback for testing
      const idb = typeof indexedDB !== "undefined" ? indexedDB : globalThis.indexedDB;
      if (!idb) {
        console.warn("IndexedDB not available, using in-memory mock storage.");
        this.db = new InMemoryStore();
        return resolve(this.db);
      }

      const request = idb.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: "modelId" });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to open IndexedDB '${DB_NAME}': ${event.target.error}`));
      };
    });

    return this.initPromise;
  }

  async _getStore(mode = "readonly") {
    await this.initialize();
    if (this.db instanceof InMemoryStore) {
      return this.db;
    }
    const tx = this.db.transaction(METADATA_STORE, mode);
    return tx.objectStore(METADATA_STORE);
  }

  // ----------------------------------------------------------------
  // Metadata & State Machine
  // ----------------------------------------------------------------

  async getMetadata(modelId) {
    const store = await this._getStore("readonly");
    if (store instanceof InMemoryStore) {
      return store.get(modelId);
    }
    return new Promise((resolve, reject) => {
      const request = store.get(modelId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveMetadata(metadata) {
    if (!metadata || !metadata.modelId) {
      throw new Error("Metadata must contain a modelId");
    }
    metadata.updatedAt = Date.now();

    const store = await this._getStore("readwrite");
    if (store instanceof InMemoryStore) {
      store.put(metadata);
      return metadata;
    }
    return new Promise((resolve, reject) => {
      const request = store.put(metadata);
      request.onsuccess = () => resolve(metadata);
      request.onerror = () => reject(request.error);
    });
  }

  async exists(modelId) {
    const meta = await this.getMetadata(modelId);
    return meta !== null && meta.status === MODEL_STATES.READY;
  }

  async getModelStatus(modelId) {
    const meta = await this.getMetadata(modelId);
    if (!meta) {
      return {
        status: MODEL_STATES.NOT_INSTALLED,
        downloadedBytes: 0,
        totalBytes: 0,
        progress: 0,
      };
    }
    return {
      status: meta.status,
      downloadedBytes: meta.downloadedBytes || 0,
      totalBytes: meta.totalBytes || 0,
      progress: meta.totalBytes > 0 ? Math.round((meta.downloadedBytes / meta.totalBytes) * 100) : 0,
      error: meta.error || null,
      installedAt: meta.installedAt || null,
      revision: meta.revision || null,
    };
  }

  async markInstalling(modelId, revision, totalBytes) {
    const existing = (await this.getMetadata(modelId)) || {};
    return this.saveMetadata({
      ...existing,
      modelId,
      status: MODEL_STATES.DOWNLOADING,
      revision,
      totalBytes,
      downloadedBytes: existing.downloadedBytes || 0,
      verifiedArtifacts: existing.verifiedArtifacts || [],
      error: null,
    });
  }

  async updateProgress(modelId, downloadedBytes, status = MODEL_STATES.DOWNLOADING) {
    const meta = await this.getMetadata(modelId);
    if (!meta) return;
    meta.downloadedBytes = downloadedBytes;
    meta.status = status;
    return this.saveMetadata(meta);
  }

  async markReady(modelId, revision, totalBytes, verifiedArtifacts = []) {
    return this.saveMetadata({
      modelId,
      status: MODEL_STATES.READY,
      revision,
      totalBytes,
      downloadedBytes: totalBytes,
      verifiedArtifacts,
      installedAt: Date.now(),
      error: null,
    });
  }

  async markFailed(modelId, error) {
    const existing = (await this.getMetadata(modelId)) || { modelId };
    return this.saveMetadata({
      ...existing,
      status: MODEL_STATES.FAILED,
      error: typeof error === "string" ? error : error?.message || "Unknown download error",
    });
  }

  async listInstalledModels() {
    const store = await this._getStore("readonly");
    if (store instanceof InMemoryStore) {
      return store.getAll();
    }
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // ----------------------------------------------------------------
  // Binary Artifact Storage (Cache API)
  // ----------------------------------------------------------------

  async _getCache() {
    if (typeof caches === "undefined") {
      if (!this._memoryCache) {
        this._memoryCache = new Map();
      }
      return {
        match: async (url) => {
          const key = typeof url === "string" ? url : url.url;
          const val = this._memoryCache.get(key);
          if (!val) return undefined;
          return new Response(val.clone ? val.clone() : val);
        },
        put: async (url, response) => {
          const key = typeof url === "string" ? url : url.url;
          const buf = await response.arrayBuffer();
          this._memoryCache.set(key, buf);
        },
        delete: async (url) => {
          const key = typeof url === "string" ? url : url.url;
          return this._memoryCache.delete(key);
        },
        keys: async () => {
          return Array.from(this._memoryCache.keys()).map((u) => new Request(u));
        },
      };
    }
    return caches.open(CACHE_NAME);
  }

  async putArtifact(url, arrayBuffer, mimeType = "application/octet-stream") {
    const cache = await this._getCache();
    const headers = new Headers({
      "Content-Type": mimeType,
      "Content-Length": String(arrayBuffer.byteLength),
      "X-PairIt-Stored": "true",
    });
    const response = new Response(arrayBuffer, { headers });
    await cache.put(url, response);
  }

  async getArtifact(url) {
    const cache = await this._getCache();
    const response = await cache.match(url);
    if (!response) {
      return null;
    }
    return response.arrayBuffer();
  }

  async hasArtifact(url) {
    const cache = await this._getCache();
    const match = await cache.match(url);
    return Boolean(match);
  }

  async deleteArtifact(url) {
    const cache = await this._getCache();
    return cache.delete(url);
  }

  async deleteModel(modelId, artifactUrls = []) {
    // 1. Mark as DELETING
    const meta = await this.getMetadata(modelId);
    if (meta) {
      await this.saveMetadata({
        ...meta,
        status: MODEL_STATES.DELETING,
      });
    }

    // 2. Remove all cached binary artifacts
    const cache = await this._getCache();
    for (const url of artifactUrls) {
      try {
        await cache.delete(url);
      } catch (err) {
        console.warn(`Failed to delete artifact ${url}:`, err);
      }
    }

    // 3. Remove metadata from IndexedDB
    const store = await this._getStore("readwrite");
    if (store instanceof InMemoryStore) {
      store.delete(modelId);
    } else {
      await new Promise((resolve, reject) => {
        const req = store.delete(modelId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }

    return true;
  }

  // ----------------------------------------------------------------
  // Storage Quota
  // ----------------------------------------------------------------

  async getStorageUsage() {
    if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const available = Math.max(0, quota - usage);
        return {
          usage,
          quota,
          available,
          formattedUsage: this.formatBytes(usage),
          formattedAvailable: this.formatBytes(available),
          formattedQuota: this.formatBytes(quota),
        };
      } catch (err) {
        console.warn("navigator.storage.estimate() failed:", err);
      }
    }

    // Fallback if storage API is unavailable or mocked
    return {
      usage: 0,
      quota: 10 * 1024 * 1024 * 1024, // 10 GB default
      available: 10 * 1024 * 1024 * 1024,
      formattedUsage: "0 MB",
      formattedAvailable: "10.00 GB",
      formattedQuota: "10.00 GB",
    };
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}

/**
 * Lightweight in-memory fallback for environments without browser IndexedDB
 */
class InMemoryStore {
  constructor() {
    this.map = new Map();
  }
  get(key) {
    return this.map.get(key) || null;
  }
  put(val) {
    this.map.set(val.modelId, val);
  }
  delete(key) {
    this.map.delete(key);
  }
  getAll() {
    return Array.from(this.map.values());
  }
}

// Module export for Node.js / bundling / browser
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ModelStorage, MODEL_STATES };
} else if (typeof globalThis !== "undefined") {
  globalThis.ModelStorage = ModelStorage;
  globalThis.MODEL_STATES = MODEL_STATES;
}
