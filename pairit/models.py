from __future__ import annotations

from typing import Any

from .exceptions import UnknownModelError, UnsupportedOperationError

STATEFUL_MODELS: dict[str, dict[str, Any]] = {
    "chatgpt": {
        "id": "chatgpt",
        "displayName": "ChatGPT",
        "category": "stateful",
        "capabilities": {"chat"},
    },
    "claude": {
        "id": "claude",
        "displayName": "Claude",
        "category": "stateful",
        "capabilities": {"chat"},
    },
    "gemini": {
        "id": "gemini",
        "displayName": "Gemini",
        "category": "stateful",
        "capabilities": {"chat"},
    },
}

STATELESS_MODELS: dict[str, dict[str, Any]] = {
    "qwen3-0.6b": {
        "id": "qwen3-0.6b",
        "displayName": "Qwen3 0.6B",
        "category": "llm",
        "capabilities": {"chat"},
    },
    "smollm2-360m": {
        "id": "smollm2-360m",
        "displayName": "SmolLM2 360M",
        "category": "llm",
        "capabilities": {"chat"},
    },
    "qwen2.5-coder-0.5b": {
        "id": "qwen2.5-coder-0.5b",
        "displayName": "Qwen2.5-Coder 0.5B",
        "category": "llm",
        "capabilities": {"chat"},
    },
    "smolvlm-500m": {
        "id": "smolvlm-500m",
        "displayName": "SmolVLM 500M",
        "category": "vlm",
        "capabilities": {"vision"},
    },
    "moondream2": {
        "id": "moondream2",
        "displayName": "Moondream2",
        "category": "vlm",
        "capabilities": {"vision"},
    },
    "vit-gpt2-image-captioning": {
        "id": "vit-gpt2-image-captioning",
        "displayName": "ViT-GPT2 Captioner",
        "category": "vlm",
        "capabilities": {"vision"},
    },
    "all-minilm-l6-v2": {
        "id": "all-minilm-l6-v2",
        "displayName": "all-MiniLM-L6-v2",
        "category": "embedding",
        "capabilities": {"embed"},
    },
    "bge-small-en-v1.5": {
        "id": "bge-small-en-v1.5",
        "displayName": "BGE Small EN v1.5",
        "category": "embedding",
        "capabilities": {"embed"},
    },
    "smollm2-135m": {
        "id": "smollm2-135m",
        "displayName": "SmolLM2 135M",
        "category": "llm",
        "capabilities": {"chat"},
    },
    "gte-small": {
        "id": "gte-small",
        "displayName": "GTE Small",
        "category": "embedding",
        "capabilities": {"embed"},
    },
    "multilingual-e5-small": {
        "id": "multilingual-e5-small",
        "displayName": "Multilingual E5 Small",
        "category": "embedding",
        "capabilities": {"embed"},
    },
    "trocr-small-printed": {
        "id": "trocr-small-printed",
        "displayName": "TrOCR Small Printed",
        "category": "vlm",
        "capabilities": {"vision"},
    },
}

MODEL_ALIASES: dict[str, str] = {
    # LLM Aliases
    "qwen2.5-0.5b": "qwen3-0.6b",
    "qwen2.5": "qwen3-0.6b",
    "qwen3": "qwen3-0.6b",
    "qwen": "qwen3-0.6b",
    "qwen 3": "qwen3-0.6b",
    "qwen 3 0.6b": "qwen3-0.6b",
    "smollm2 360m": "smollm2-360m",
    "smollm2-360": "smollm2-360m",
    "smollm2 135m": "smollm2-135m",
    "smollm2-135": "smollm2-135m",
    "qwen2.5 coder 0.5b": "qwen2.5-coder-0.5b",
    "qwen2.5-coder": "qwen2.5-coder-0.5b",
    "qwen-coder": "qwen2.5-coder-0.5b",
    # Embedding Aliases
    "all minilm l6 v2": "all-minilm-l6-v2",
    "all-minilm": "all-minilm-l6-v2",
    "minilm": "all-minilm-l6-v2",
    "bge small en v1.5": "bge-small-en-v1.5",
    "bge small": "bge-small-en-v1.5",
    "bge": "bge-small-en-v1.5",
    "gte small": "gte-small",
    "gte": "gte-small",
    "multilingual e5 small": "multilingual-e5-small",
    "multilingual-e5": "multilingual-e5-small",
    "e5": "multilingual-e5-small",
    # VLM Aliases
    "smolvlm 500m": "smolvlm-500m",
    "smolvlm": "smolvlm-500m",
    "moondream": "moondream2",
    "vit-gpt2": "vit-gpt2-image-captioning",
    "vit gpt2": "vit-gpt2-image-captioning",
    "vit-gpt2 captioner": "vit-gpt2-image-captioning",
    "trocr small printed": "trocr-small-printed",
    "trocr": "trocr-small-printed",
    "trocr-small": "trocr-small-printed",
}


def normalize_model_name(name: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Model name must be a non-empty string.")
    raw_norm = name.lower().strip()
    if raw_norm in STATEFUL_MODELS or raw_norm in STATELESS_MODELS:
        return raw_norm
    if raw_norm in MODEL_ALIASES:
        return MODEL_ALIASES[raw_norm]

    # Match by displayName (case-insensitive)
    for model_id, model_spec in STATELESS_MODELS.items():
        disp = model_spec.get("displayName", "").lower().strip()
        if raw_norm == disp:
            return model_id

    # Fallback to normalized string
    return raw_norm


def is_stateful_model(model: str) -> bool:
    return normalize_model_name(model) in STATEFUL_MODELS


def is_stateless_model(model: str) -> bool:
    return normalize_model_name(model) in STATELESS_MODELS


def get_model_category(model: str) -> str:
    norm = normalize_model_name(model)
    if norm in STATEFUL_MODELS:
        return "stateful"
    if norm in STATELESS_MODELS:
        return STATELESS_MODELS[norm]["category"]
    raise UnknownModelError(f"Unknown model '{model}'. Valid models: {list_supported_models()}")


def get_model_capabilities(model: str) -> set[str]:
    norm = normalize_model_name(model)
    if norm in STATEFUL_MODELS:
        return STATEFUL_MODELS[norm]["capabilities"]
    if norm in STATELESS_MODELS:
        return STATELESS_MODELS[norm]["capabilities"]
    raise UnknownModelError(f"Unknown model '{model}'. Valid models: {list_supported_models()}")


def validate_model_operation(model: str, operation: str) -> None:
    norm = normalize_model_name(model)
    if norm not in STATEFUL_MODELS and norm not in STATELESS_MODELS:
        raise UnknownModelError(
            f"Unknown model '{model}'. Available models: {', '.join(list_supported_models())}"
        )

    caps = get_model_capabilities(norm)
    if operation not in caps:
        raise UnsupportedOperationError(
            f"Model '{norm}' does not support '{operation}()'. Supported operations: {', '.join(caps)}"
        )


def list_supported_models() -> list[str]:
    return list(STATEFUL_MODELS.keys()) + list(STATELESS_MODELS.keys())
