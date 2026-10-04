/**
 * ModelRegistry
 *
 * Source of truth for curated Stateless Models.
 * Enforces:
 * - Immutable commit hashes (never "main")
 * - Exact SHA-256 and size verification for all artifacts
 * - Known capabilities (chat, vision, embed)
 * - Safe model IDs (no path traversal)
 */

var ModelRegistry = class ModelRegistry {
  constructor(registryData) {
    this.models = new Map();
    this.schemaVersion = 1;
    this.registryVersion = 1;

    if (registryData) {
      this.load(registryData);
    }
  }

  load(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid registry data: must be an object");
    }

    this.schemaVersion = data.schemaVersion || 1;
    this.registryVersion = data.registryVersion || 1;

    if (!Array.isArray(data.models)) {
      throw new Error("Invalid registry data: models must be an array");
    }

    const seenIds = new Set();

    for (const model of data.models) {
      this.validateModelSpec(model);

      if (seenIds.has(model.id)) {
        throw new Error(`Duplicate model ID in registry: ${model.id}`);
      }
      seenIds.add(model.id);

      // Deep copy to prevent mutation
      this.models.set(model.id, JSON.parse(JSON.stringify(model)));
    }
  }

  validateModelSpec(model) {
    if (!model || typeof model !== "object") {
      throw new Error("Model specification must be an object");
    }

    const idRegex = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/;
    if (!model.id || !idRegex.test(model.id)) {
      throw new Error(`Invalid model ID '${model.id}': must be lowercase alphanumeric with dashes/dots/underscores.`);
    }

    if (model.id.includes("..") || model.id.includes("/") || model.id.includes("\\")) {
      throw new Error(`Path traversal attempted in model ID: ${model.id}`);
    }

    if (!model.displayName || typeof model.displayName !== "string") {
      throw new Error(`Model ${model.id} missing valid displayName`);
    }

    const validCategories = ["llm", "embedding", "vlm"];
    if (!validCategories.includes(model.category)) {
      throw new Error(`Model ${model.id} has invalid category: ${model.category}`);
    }

    const validCapabilities = ["chat", "vision", "embed"];
    if (!Array.isArray(model.capabilities) || model.capabilities.length === 0) {
      throw new Error(`Model ${model.id} must define at least one capability`);
    }

    for (const cap of model.capabilities) {
      if (!validCapabilities.includes(cap)) {
        throw new Error(`Model ${model.id} has invalid capability: ${cap}`);
      }
    }

    if (!model.source || typeof model.source !== "object") {
      throw new Error(`Model ${model.id} missing source definition`);
    }

    if (!model.source.repository || typeof model.source.repository !== "string") {
      throw new Error(`Model ${model.id} missing repository`);
    }

    if (!model.source.revision || model.source.revision === "main" || model.source.revision === "latest") {
      throw new Error(`Model ${model.id} must use an immutable git commit hash, not '${model.source.revision}'`);
    }

    if (!model.license || typeof model.license !== "object" || !model.license.name) {
      throw new Error(`Model ${model.id} missing license metadata`);
    }

    if (!Array.isArray(model.artifacts) || model.artifacts.length === 0) {
      throw new Error(`Model ${model.id} must declare at least one artifact`);
    }

    for (const artifact of model.artifacts) {
      if (!artifact.path || typeof artifact.path !== "string") {
        throw new Error(`Model ${model.id} artifact missing path`);
      }
      if (artifact.path.includes("..")) {
        throw new Error(`Model ${model.id} artifact contains path traversal: ${artifact.path}`);
      }
      if (!artifact.url || typeof artifact.url !== "string") {
        throw new Error(`Model ${model.id} artifact missing url`);
      }
      if (typeof artifact.sizeBytes !== "number" || artifact.sizeBytes <= 0) {
        throw new Error(`Model ${model.id} artifact ${artifact.path} has invalid sizeBytes`);
      }
      if (!artifact.sha256 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
        throw new Error(`Model ${model.id} artifact ${artifact.path} has invalid or missing sha256 hash`);
      }
    }
  }

  hasModel(modelId) {
    return this.models.has(modelId);
  }

  getModel(modelId) {
    const model = this.models.get(modelId);
    if (!model) {
      return null;
    }
    return JSON.parse(JSON.stringify(model));
  }

  listModels() {
    return Array.from(this.models.values()).map((m) => JSON.parse(JSON.stringify(m)));
  }

  getRequiredStorageBytes(modelId, safetyMarginBytes = 100 * 1024 * 1024) {
    const model = this.getModel(modelId);
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    const totalArtifactBytes = model.artifacts.reduce((acc, a) => acc + a.sizeBytes, 0);
    const required = model.requirements?.minimumFreeStorageBytes || totalArtifactBytes;
    return Math.max(required, totalArtifactBytes) + safetyMarginBytes;
  }

  validateCapability(modelId, operation) {
    const model = this.getModel(modelId);
    if (!model) {
      return { ok: false, error: `Unknown model '${modelId}'` };
    }

    const map = {
      chat: "chat",
      vision: "vision",
      embed: "embed",
    };

    const neededCap = map[operation];
    if (!neededCap || !model.capabilities.includes(neededCap)) {
      return {
        ok: false,
        error: `Model '${modelId}' does not support operation '${operation}'. Supported capabilities: [${model.capabilities.join(", ")}]`,
      };
    }

    return { ok: true };
  }
}

// Support both Node.js (testing/building) and browser/worker ES / global environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ModelRegistry };
} else if (typeof globalThis !== "undefined") {
  globalThis.ModelRegistry = ModelRegistry;
}
