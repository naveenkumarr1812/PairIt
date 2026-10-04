/**
 * PairIt Stateless Model Worker
 *
 * Runs inside a dedicated Web Worker hosted by the MV3 offscreen document.
 * - Bundled with @huggingface/transformers & onnxruntime-web
 * - Enforces offline operation using PairIt Model Storage Cache
 * - Detects WebGPU with graceful WASM/CPU fallback
 * - Implements single-model memory policy (lazy load, serialize execution, unload on switch)
 * - Handles chat, vision, and embed operations
 */

import {
  env,
  pipeline,
  AutoTokenizer,
  AutoModelForCausalLM,
  AutoModel,
  RawImage,
} from "@huggingface/transformers";

// Global runtime state
let currentModelId = null;
let currentPipeline = null;
let currentBackend = null;
let activeRequestId = null;
let isBusy = false;

// Configure Transformers.js environment
// allowLocalModels=false: we don't serve from local filesystem paths
// allowRemoteModels=true: required by Transformers.js env validation;
//   offline enforcement is handled by the custom cache (pairit-models-v1) —
//   all model files are intercepted from Cache API before any network request.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
env.useCustomCache = true;

// Configure local WASM paths within the extension package
const wasmBase = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL)
  ? chrome.runtime.getURL("stateless/wasm/")
  : (typeof self !== "undefined" && self.location && self.location.href
    ? self.location.href.replace(/dist\/model-worker\.bundle\.js.*$/, "wasm/")
    : "");

if (env.backends?.onnx) {
  env.backends.onnx.logLevel = "error";
  if (env.backends.onnx.wasm) {
    if (wasmBase) {
      env.backends.onnx.wasm.wasmPaths = wasmBase;
    }
    if (typeof crossOriginIsolated === "undefined" || !crossOriginIsolated) {
      env.backends.onnx.wasm.numThreads = 1;
    }
  }
}

const CACHE_NAME = "pairit-models-v1";

async function initializeCache() {
  if (typeof caches !== "undefined") {
    try {
      env.customCache = await caches.open(CACHE_NAME);
    } catch (e) {
      console.warn("[PairIt Worker] Could not open custom cache:", e);
    }
  }
}

async function isWebGPUSupported() {
  if (typeof navigator !== "undefined" && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return Boolean(adapter);
    } catch (e) {
      return false;
    }
  }
  return false;
}

/**
 * Unloads the currently active model from memory.
 */
async function unloadCurrentModel() {
  if (currentPipeline) {
    try {
      if (typeof currentPipeline.dispose === "function") {
        await currentPipeline.dispose();
      }
    } catch (e) {
      console.warn("[PairIt Worker] Error disposing pipeline:", e);
    }
    currentPipeline = null;
  }
  currentModelId = null;
  currentBackend = null;
  // Hint garbage collection
  if (typeof globalThis.gc === "function") {
    try { globalThis.gc(); } catch (_) { }
  }
}

/**
 * Loads a model into memory following the single-model policy.
 */
async function loadModel(modelSpec) {
  const modelId = modelSpec.id;
  if (currentModelId === modelId && currentPipeline) {
    return { modelId, backend: currentBackend };
  }

  // Enforce memory policy: unload any other loaded model
  await unloadCurrentModel();

  await initializeCache();

  const webgpuAvailable = await isWebGPUSupported();
  const preferWebGPU = Boolean(webgpuAvailable && modelSpec.runtime?.webgpu);
  let selectedDevice = preferWebGPU ? "webgpu" : "wasm";
  let loadedPipe = null;

  const repo = modelSpec.source.repository;
  const revision = modelSpec.source.revision;

  console.log(`[PairIt Worker] Loading model '${modelId}' on device '${selectedDevice}'...`);

  let pipelineTask = modelSpec.runtime.pipeline;
  if (pipelineTask === "image-text-to-text") {
    pipelineTask = "image-to-text";
  }

  const VALID_DTYPES = new Set(["auto", "fp32", "fp16", "q8", "int8", "uint8", "q4", "bnb4", "q4f16"]);
  let modelDtype = modelSpec.runtime.dtype || "q4";
  if (modelDtype === "quantized") {
    modelDtype = "q8";
  } else if (!VALID_DTYPES.has(modelDtype)) {
    modelDtype = "auto";
  }

  const pipeOptions = {
    revision,
    device: selectedDevice,
    dtype: modelDtype,
  };

  try {
    loadedPipe = await pipeline(pipelineTask, repo, pipeOptions);
  } catch (gpuError) {
    if (selectedDevice === "webgpu") {
      console.warn(`[PairIt Worker] WebGPU load failed for '${modelId}'. Falling back to CPU/WASM:`, gpuError);
      selectedDevice = "wasm";
      pipeOptions.device = "wasm";
      try {
        loadedPipe = await pipeline(pipelineTask, repo, pipeOptions);
      } catch (wasmError) {
        throw new Error(`Failed to load model '${modelId}' on both WebGPU and WASM: ${wasmError.message}`);
      }
    } else {
      throw gpuError;
    }
  }

  currentModelId = modelId;
  currentPipeline = loadedPipe;
  currentBackend = selectedDevice;

  console.log(`[PairIt Worker] Model '${modelId}' loaded successfully with backend '${selectedDevice}'.`);
  return { modelId, backend: selectedDevice };
}

/**
 * Execute chat inference
 */
async function runChat(modelSpec, payload) {
  await loadModel(modelSpec);

  // Normalize messages
  let messages = payload.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    if (payload.prompt) {
      messages = [{ role: "user", content: payload.prompt }];
    } else {
      messages = [{ role: "user", content: "" }];
    }
  }

  const maxNewTokens = payload.max_new_tokens || payload.max_tokens || 256;
  const temperature = typeof payload.temperature === "number" ? payload.temperature : 0.7;

  let output;
  try {
    // Passing messages directly lets transformers.js apply chat_template,
    // which injects EOS/stop tokens (<|im_end|>) so the model stops when done
    output = await currentPipeline(messages, {
      max_new_tokens: maxNewTokens,
      temperature,
      do_sample: temperature > 0,
      return_full_text: false,
    });
  } catch (directErr) {
    console.warn("[PairIt Worker] Direct chat pipeline failed, using formatted prompt:", directErr);
    let promptText;
    if (currentPipeline.tokenizer?.apply_chat_template) {
      try {
        promptText = currentPipeline.tokenizer.apply_chat_template(messages, {
          tokenize: false,
          add_generation_prompt: true,
        });
      } catch (_) {
        promptText = messages.map((m) => `${m.role}: ${m.content}`).join("\n") + "\nassistant:\n";
      }
    } else {
      promptText = messages.map((m) => `${m.role}: ${m.content}`).join("\n") + "\nassistant:\n";
    }

    output = await currentPipeline(promptText, {
      max_new_tokens: maxNewTokens,
      temperature,
      do_sample: temperature > 0,
      return_full_text: false,
    });
  }

  let generatedText = "";
  if (Array.isArray(output) && output.length > 0) {
    const item = output[0];
    if (typeof item === "string") {
      generatedText = item;
    } else if (item.generated_text) {
      if (Array.isArray(item.generated_text)) {
        // [{ role: 'assistant', content: '...' }]
        const lastMsg = item.generated_text[item.generated_text.length - 1];
        generatedText = lastMsg?.content || "";
      } else if (typeof item.generated_text === "string") {
        generatedText = item.generated_text;
      }
    }
  } else if (typeof output === "string") {
    generatedText = output;
  }

  return {
    content: generatedText.trim(),
    model: modelSpec.id,
    backend: currentBackend,
  };
}

/**
 * Execute embedding inference
 */
async function runEmbed(modelSpec, payload) {
  await loadModel(modelSpec);

  const texts = Array.isArray(payload.texts) ? payload.texts : [payload.texts || payload.text || ""];
  const output = await currentPipeline(texts, {
    pooling: "mean",
    normalize: true,
  });

  const vectors = [];
  const dims = modelSpec.runtime.dimensions || 384;

  if (output && output.tolist) {
    const list = output.tolist();
    for (const item of list) {
      vectors.push(Array.isArray(item) ? item : [item]);
    }
  } else if (Array.isArray(output)) {
    for (const item of output) {
      if (item && item.tolist) {
        vectors.push(item.tolist());
      } else if (Array.isArray(item)) {
        vectors.push(item);
      }
    }
  }

  return {
    model: modelSpec.id,
    dimensions: dims,
    vectors,
    backend: currentBackend,
  };
}

/**
 * Execute vision inference
 */
async function runVision(modelSpec, payload) {
  await loadModel(modelSpec);

  const imageInput = payload.image;
  const prompt = payload.prompt || "Describe this image.";

  if (!imageInput) {
    throw new Error("No image data provided for vision request.");
  }

  // Load image through Transformers.js RawImage
  let rawImg;
  if (typeof imageInput === "string" && imageInput.startsWith("data:")) {
    rawImg = await RawImage.fromURL(imageInput);
  } else {
    rawImg = await RawImage.read(imageInput);
  }

  // Format SmolVLM multimodal input
  const messages = [
    {
      role: "user",
      content: [
        { type: "image" },
        { type: "text", text: prompt },
      ],
    },
  ];

  let formattedPrompt = "";
  if (modelSpec.id === "moondream2") {
    formattedPrompt = `<image>\n\nQuestion: ${prompt}\n\nAnswer:`;
  } else if (currentPipeline.processor?.tokenizer?.apply_chat_template) {
    try {
      formattedPrompt = currentPipeline.processor.tokenizer.apply_chat_template(messages, {
        tokenize: false,
        add_generation_prompt: true,
      });
    } catch (_) { }
  }
  if (!formattedPrompt && currentPipeline.processor?.apply_chat_template) {
    try {
      formattedPrompt = currentPipeline.processor.apply_chat_template(messages, {
        tokenize: false,
        add_generation_prompt: true,
      });
    } catch (_) { }
  }
  if (!formattedPrompt) {
    formattedPrompt = `<|im_start|>User:<image>${prompt}<end_of_utterance>\nAssistant:`;
  }

  let generatedText = "";
  if (currentPipeline.processor && currentPipeline.model?.generate) {
    const inputs = await currentPipeline.processor(formattedPrompt, rawImg, {
      do_image_splitting: false,
    });
    const eosTokenId = currentPipeline.tokenizer?.eos_token_id || [49279, 2, 1];
    const maxTokens = payload.max_new_tokens || 1024;
    const temp = typeof payload.temperature === "number" ? payload.temperature : (payload.do_sample ? 0.7 : undefined);
    const doSample = payload.do_sample !== undefined ? Boolean(payload.do_sample) : (temp !== undefined && temp > 0);

    const generateOptions = {
      ...inputs,
      max_new_tokens: maxTokens,
      do_sample: doSample,
      no_repeat_ngram_size: payload.no_repeat_ngram_size || 3,
      eos_token_id: eosTokenId,
    };
    if (temp !== undefined) {
      generateOptions.temperature = temp;
    }
    if (payload.top_p !== undefined) {
      generateOptions.top_p = payload.top_p;
    }
    if (payload.repetition_penalty !== undefined) {
      generateOptions.repetition_penalty = payload.repetition_penalty;
    }

    const output = await currentPipeline.model.generate(generateOptions);

    const decoded = currentPipeline.processor.batch_decode(output, {
      skip_special_tokens: false,
    });
    let rawText = decoded[0] || "";

    // Extract text after Assistant:
    const assistantParts = rawText.split(/Assistant:\s*/i);
    let answer = assistantParts.length > 1 ? assistantParts[assistantParts.length - 1] : rawText;

    // Cut off at stop tokens
    for (const stopToken of ["<end_of_utterance>", "<|im_end|>", "<|endoftext|>", "User:"]) {
      if (answer.includes(stopToken)) {
        answer = answer.split(stopToken)[0];
      }
    }

    // Strip internal special tags
    answer = answer
      .replace(/<\|[^>]*\|>/g, "")
      .replace(/<fake_token[^>]*>/g, "")
      .replace(/<image>/g, "")
      .trim();

    // Deduplicate any consecutive repeating lines / phrases
    const lines = answer.split("\n");
    const cleanedLines = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== "") {
          cleanedLines.push("");
        }
        continue;
      }
      if (cleanedLines.length === 0 || cleanedLines[cleanedLines.length - 1] !== trimmed) {
        cleanedLines.push(trimmed);
      }
    }
    generatedText = cleanedLines.join("\n").trim();
  } else {
    const output = await currentPipeline(rawImg, {
      max_new_tokens: payload.max_new_tokens || 1024,
    });
    if (Array.isArray(output) && output.length > 0) {
      generatedText = output[0].generated_text || "";
    } else if (typeof output === "string") {
      generatedText = output;
    }
  }

  return {
    content: generatedText.trim(),
    model: modelSpec.id,
    backend: currentBackend,
  };
}

// ----------------------------------------------------------------
// Worker Message Listener
// ----------------------------------------------------------------

self.addEventListener("message", async (event) => {
  const { type, requestId, modelSpec, operation, payload } = event.data || {};

  if (type === "ping") {
    self.postMessage({ type: "pong" });
    return;
  }

  if (type === "detect_backend") {
    const gpu = await isWebGPUSupported();
    self.postMessage({
      type: "backend_detected",
      webgpu: gpu,
      device: gpu ? "webgpu" : "wasm",
    });
    return;
  }

  if (type === "unload_model") {
    await unloadCurrentModel();
    self.postMessage({
      type: "model_unloaded",
      requestId,
      success: true,
    });
    return;
  }

  if (type === "model_request") {
    const now = Date.now();
    if (isBusy) {
      if (globalThis.__pairitBusySince && now - globalThis.__pairitBusySince > 45000) {
        console.warn("[PairIt Worker] Previous request timed out or was abandoned. Resetting isBusy.");
        isBusy = false;
        activeRequestId = null;
      } else {
        self.postMessage({
          type: "model_error",
          requestId,
          model: modelSpec?.id,
          code: "model_busy",
          message: "Worker is currently processing another request.",
        });
        return;
      }
    }

    isBusy = true;
    globalThis.__pairitBusySince = now;
    activeRequestId = requestId;

    try {
      let result;
      if (operation === "chat") {
        result = await runChat(modelSpec, payload);
      } else if (operation === "embed") {
        result = await runEmbed(modelSpec, payload);
      } else if (operation === "vision") {
        result = await runVision(modelSpec, payload);
      } else {
        throw new Error(`Unsupported operation: ${operation}`);
      }

      self.postMessage({
        type: "model_response",
        requestId,
        model: modelSpec.id,
        operation,
        data: result,
      });
    } catch (error) {
      console.error(`[PairIt Worker] Request ${requestId} failed:`, error);
      const isOOM = /out of memory|quota|buffer/i.test(error.message);
      self.postMessage({
        type: "model_error",
        requestId,
        model: modelSpec?.id,
        code: isOOM ? "model_out_of_memory" : "model_runtime_error",
        message: error.message || "Model execution failed",
      });
    } finally {
      isBusy = false;
      activeRequestId = null;
    }
  }
});
