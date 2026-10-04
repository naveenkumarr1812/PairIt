from __future__ import annotations

import base64
import mimetypes
import os
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from .bridge import BridgeServer
from .exceptions import (
    ExtensionNotConnectedError,
    InvalidImageError,
    PairitError,
    UnknownModelError,
    UnsupportedOperationError,
)
from .models import (
    STATEFUL_MODELS,
    STATELESS_MODELS,
    get_model_capabilities,
    get_model_category,
    is_stateful_model,
    is_stateless_model,
    list_supported_models,
    normalize_model_name,
    validate_model_operation,
)
from .types import ChatChunk, ChatResponse, EmbeddingResponse

SUPPORTED_PROVIDERS = set(STATEFUL_MODELS.keys())

DEFAULT_ERROR_MESSAGE = (
    "PairIt extension is not connected. First connect with the PairIt extension, then try again."
)

MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10MB limit for localhost transfer


_MISSING = object()  # Sentinel for no model specified


class Client:
    """
    Unified PairIt Client.

    Supports both:
    1. STATEFUL MODELS (browser AI sessions):
       - "chatgpt", "claude", "gemini"
    2. STATELESS MODELS (locally downloaded models, downloaded via the PairIt extension):
       - LLM Chat     : "qwen3-0.6b", "smollm2-135m", "smollm2-360m", "qwen2.5-coder-0.5b"
       - Embedding    : "all-minilm-l6-v2", "bge-small-en-v1.5", "gte-small", "multilingual-e5-small"
       - Vision (VLM) : "smolvlm-500m", "moondream2", "vit-gpt2-image-captioning", "trocr-small-printed"

    A model name MUST be provided when creating a Client instance. Example::

        client = Client("qwen3-0.6b")      # Local LLM
        client = Client("chatgpt")          # Browser ChatGPT
        client = Client("all-minilm-l6-v2") # Embedding
    """

    def __init__(
        self,
        model: str = _MISSING,  # type: ignore[assignment]
        *,
        provider: str | None = None,
        host: str = "127.0.0.1",
        port: int = 8765,
    ) -> None:
        # If neither model nor provider is given, raise a clear guiding error
        if model is _MISSING and provider is None:
            supported = list_supported_models()
            llm     = [m for m in supported if m in ("qwen3-0.6b", "smollm2-135m", "smollm2-360m", "qwen2.5-coder-0.5b")]
            embed   = [m for m in supported if m in ("all-minilm-l6-v2", "bge-small-en-v1.5", "gte-small", "multilingual-e5-small")]
            vlm     = [m for m in supported if m in ("smolvlm-500m", "moondream2", "vit-gpt2-image-captioning", "trocr-small-printed")]
            stateful = [m for m in supported if m in ("chatgpt", "claude", "gemini")]
            raise TypeError(
                "Client() requires a model name.\n\n"
                "Usage: client = Client(\"<model_name>\")\n\n"
                "Available models:\n"
                f"  Browser (Stateful) : {', '.join(stateful)}\n"
                f"  LLM (Chat)         : {', '.join(llm)}\n"
                f"  Embedding          : {', '.join(embed)}\n"
                f"  Vision (VLM)       : {', '.join(vlm)}\n\n"
                "Tip: Copy the model name from the PairIt extension popup using the Copy button,\n"
                "     then paste it here: client = Client(\"<paste-model-id-here>\")"
            )

        # Preserve backward compatibility with Client(provider="chatgpt")
        target_name = provider if provider is not None else model
        target_name = normalize_model_name(target_name)

        if not is_stateful_model(target_name) and not is_stateless_model(target_name):
            raise UnknownModelError(
                f"Unknown model '{target_name}'. "
                f"Supported models: {', '.join(list_supported_models())}"
            )

        self._model = target_name
        self._model_type = get_model_category(target_name)
        self._capabilities = get_model_capabilities(target_name)

        # For stateful models, provider matches model name. For stateless, provider is "stateless"
        if is_stateful_model(target_name):
            self._provider = target_name
        else:
            self._provider = "stateless"

        self._bridge = BridgeServer(
            host=host,
            port=port,
        )
        self._closed = False
        self._init_error: str | None = None

        try:
            self._bridge.start()
            if is_stateful_model(target_name):
                self._bridge.set_provider(target_name)
        except Exception as error:
            self._init_error = self._friendly_error(error)

    # ================================================================
    # Properties
    # ================================================================

    @property
    def model(self) -> str:
        """The active model name."""
        return self._model

    @property
    def model_type(self) -> str:
        """The category: 'stateful' or 'stateless' / 'llm' / 'vlm' / 'embedding'."""
        return self._model_type

    @property
    def capabilities(self) -> set[str]:
        """Supported capabilities for this model: {'chat'}, {'vision'}, {'embed'}."""
        return set(self._capabilities)

    @property
    def provider(self) -> str:
        """Provider identifier for backward compatibility."""
        return self._provider

    @property
    def extension_connected(self) -> bool:
        """Whether the PairIt Chrome extension is connected to the bridge."""
        try:
            return self._bridge.extension_connected
        except Exception:
            return False

    def set_provider(self, provider: str) -> None:
        """Switch provider for stateful models (backward compatibility)."""
        provider = self._normalize_provider(provider)
        self._model = provider
        self._provider = provider
        self._model_type = "stateful"
        self._capabilities = get_model_capabilities(provider)

        try:
            self._bridge.set_provider(provider)
            self._init_error = None
        except Exception as error:
            self._init_error = self._friendly_error(error)

    @staticmethod
    def _normalize_provider(provider: str) -> str:
        if not isinstance(provider, str):
            raise ValueError("provider must be a string.")
        norm = normalize_model_name(provider)
        if not is_stateful_model(norm):
            raise ValueError("Unsupported provider. Use 'chatgpt', 'claude', or 'gemini'.")
        return norm

    def wait_for_extension(self, timeout: float | None = 10.0) -> bool:
        """Wait briefly for the PairIt Chrome extension to connect."""
        try:
            return self._bridge.wait_for_extension(timeout=timeout)
        except Exception:
            return False

    # ================================================================
    # Chat API
    # ================================================================

    def chat(
        self,
        prompt: str,
        *,
        model: str = "chat-window",
        stream: bool = False,
        timeout: float | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> ChatResponse | Iterator[ChatChunk]:
        """
        Send a chat generation request.

        For Stateful models: routes to ChatGPT/Claude/Gemini browser tab.
        For Stateless models: runs local LLM inference via WebGPU/WASM without history retention.
        """
        if self._closed:
            return self._build_error_response("pairit client is closed.")

        if not isinstance(prompt, str) or not prompt.strip():
            return self._build_error_response("prompt must be a non-empty string.")

        validate_model_operation(self._model, "chat")

        messages = [
            {
                "role": "user",
                "content": prompt,
            }
        ]

        # Stateless Model Execution Path
        if self._model_type != "stateful":
            if stream:
                raise NotImplementedError("Streaming is not yet implemented for stateless models.")
            return self._execute_stateless_chat(
                messages=messages,
                prompt=prompt,
                timeout=timeout,
                max_tokens=max_tokens,
                temperature=temperature,
            )

        # Stateful Model Execution Path (Existing)
        if stream:
            return self._stream_chat(
                messages,
                model=model,
                timeout=timeout,
            )

        try:
            if self._init_error:
                return self._build_error_response(self._init_error)

            result = self._bridge.chat(
                provider=self._provider,
                messages=messages,
                model=model,
                stream=False,
                timeout=timeout,
            )

            return self._build_response(result)

        except Exception as error:
            return self._build_error_response(self._friendly_error(error))

    def chat_messages(
        self,
        messages: list[dict[str, str]],
        *,
        model: str = "chat-window",
        stream: bool = False,
        timeout: float | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> ChatResponse | Iterator[ChatChunk]:
        """
        Send chat messages with explicit context.

        For Stateless models: PairIt does not automatically remember previous
        conversations, but the caller may provide conversation history explicitly.
        """
        if self._closed:
            return self._build_error_response("pairit client is closed.")

        if not isinstance(messages, list) or not messages:
            return self._build_error_response("messages must be a non-empty list.")

        validate_model_operation(self._model, "chat")

        if self._model_type != "stateful":
            if stream:
                raise NotImplementedError("Streaming is not yet implemented for stateless models.")
            return self._execute_stateless_chat(
                messages=messages,
                prompt=None,
                timeout=timeout,
                max_tokens=max_tokens,
                temperature=temperature,
            )

        if stream:
            return self._stream_chat(
                messages,
                model=model,
                timeout=timeout,
            )

        try:
            if self._init_error:
                return self._build_error_response(self._init_error)

            result = self._bridge.chat(
                provider=self._provider,
                messages=messages,
                model=model,
                stream=False,
                timeout=timeout,
            )

            return self._build_response(result)

        except Exception as error:
            return self._build_error_response(self._friendly_error(error))

    def _execute_stateless_chat(
        self,
        *,
        messages: list[dict[str, str]],
        prompt: str | None,
        timeout: float | None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> ChatResponse:
        try:
            if self._init_error:
                return self._build_error_response(self._init_error)

            payload: dict[str, Any] = {
                "messages": messages,
                "prompt": prompt,
            }
            if max_tokens is not None:
                payload["max_new_tokens"] = max_tokens
            if temperature is not None:
                payload["temperature"] = temperature

            data = self._bridge.execute_model_request(
                model=self._model,
                operation="chat",
                payload=payload,
                timeout=timeout,
            )

            content = data.get("content", "")
            return ChatResponse(
                id=f"stateless_{int(time.time() * 1000)}",
                object="chat.completion",
                created=int(time.time()),
                model=self._model,
                content=content,
                provider="stateless",
                raw=data,
            )
        except Exception as error:
            return self._build_error_response(self._friendly_error(error))

    # ================================================================
    # Vision API (VLM)
    # ================================================================

    def vision(
        self,
        image: str | Path | bytes | bytearray,
        prompt: str = "Describe this image.",
        *,
        max_new_tokens: int | None = 1024,
        temperature: float | None = None,
        timeout: float | None = None,
        **kwargs: Any,
    ) -> ChatResponse:
        """
        Send an image and prompt to a Vision-Language Model (VLM).

        The image is processed locally through PairIt's local bridge.
        No cloud inference is used for stateless models.
        """
        if self._closed:
            return self._build_error_response("pairit client is closed.")

        if self._init_error:
            return self._build_error_response(self._init_error)

        validate_model_operation(self._model, "vision")

        try:
            image_data = self._prepare_image_payload(image)

            payload: dict[str, Any] = {
                "image": image_data,
                "prompt": prompt,
                "max_new_tokens": max_new_tokens if max_new_tokens is not None else 1024,
            }
            if temperature is not None:
                payload["temperature"] = temperature
                payload["do_sample"] = temperature > 0
            payload.update(kwargs)

            data = self._bridge.execute_model_request(
                model=self._model,
                operation="vision",
                payload=payload,
                timeout=timeout,
            )

            return ChatResponse(
                id=f"stateless_vision_{int(time.time() * 1000)}",
                object="chat.completion",
                created=int(time.time()),
                model=self._model,
                content=data.get("content", ""),
                provider="stateless",
                raw=data,
            )
        except InvalidImageError:
            raise
        except Exception as error:
            return self._build_error_response(self._friendly_error(error))

    def _prepare_image_payload(self, image: str | Path | bytes | bytearray) -> str:
        """Convert image input to a safe base64 Data URL with validation."""
        if isinstance(image, (bytes, bytearray)):
            if len(image) > MAX_IMAGE_SIZE_BYTES:
                raise InvalidImageError(f"Image exceeds maximum size limit of {MAX_IMAGE_SIZE_BYTES // (1024*1024)}MB.")
            mime = self._detect_image_mime(image)
            b64 = base64.b64encode(image).decode("ascii")
            return f"data:{mime};base64,{b64}"

        if isinstance(image, (str, Path)):
            path_str = str(image)
            if path_str.startswith("data:image/"):
                return path_str

            if not os.path.isfile(path_str):
                raise InvalidImageError(f"Image file does not exist: {path_str}")

            if os.path.getsize(path_str) > MAX_IMAGE_SIZE_BYTES:
                raise InvalidImageError(f"Image file exceeds maximum size limit of {MAX_IMAGE_SIZE_BYTES // (1024*1024)}MB.")

            guessed_mime, _ = mimetypes.guess_type(path_str)
            mime = guessed_mime or "image/png"

            with open(path_str, "rb") as f:
                content = f.read()

            b64 = base64.b64encode(content).decode("ascii")
            return f"data:{mime};base64,{b64}"

        raise InvalidImageError("image must be a file path, data URL, or bytes.")

    @staticmethod
    def _detect_image_mime(data: bytes | bytearray) -> str:
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if data.startswith(b"RIFF") and len(data) > 12 and data[8:12] == b"WEBP":
            return "image/webp"
        if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
            return "image/gif"
        return "image/png"

    # ================================================================
    # Embedding API
    # ================================================================

    def embed(
        self,
        texts: str | list[str],
        *,
        timeout: float | None = None,
    ) -> EmbeddingResponse:
        """
        Generate dense vector embeddings using a stateless embedding model.

        Runs locally in the browser/worker environment via ONNX Runtime / WebGPU.
        """
        if self._closed:
            raise PairitError("pairit client is closed.")

        validate_model_operation(self._model, "embed")

        if isinstance(texts, str):
            input_list = [texts]
        elif isinstance(texts, list):
            if not all(isinstance(t, str) for t in texts):
                raise ValueError("All elements in texts list must be strings.")
            input_list = texts
        else:
            raise ValueError("texts must be a string or list of strings.")

        try:
            data = self._bridge.execute_model_request(
                model=self._model,
                operation="embed",
                payload={
                    "texts": input_list,
                },
                timeout=timeout,
            )

            vectors = data.get("vectors", [])
            dimensions = data.get("dimensions", len(vectors[0]) if vectors and isinstance(vectors[0], list) else 0)

            return EmbeddingResponse(
                model=self._model,
                vectors=vectors,
                dimensions=dimensions,
                raw=data,
            )
        except Exception as error:
            friendly_msg = self._friendly_error(error)
            return EmbeddingResponse(
                model=self._model,
                vectors=[],
                dimensions=0,
                raw={"error": friendly_msg},
            )

    # ================================================================
    # Existing Stateful Streaming & Helpers
    # ================================================================

    def _stream_chat(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        timeout: float | None,
    ) -> Iterator[ChatChunk]:
        """Stream responses while converting runtime errors to chunks."""
        try:
            if self._init_error:
                yield self._build_error_chunk(
                    self._init_error,
                    model=model,
                )
                return

            for event in self._bridge.chat_stream(
                provider=self._provider,
                messages=messages,
                model=model,
                timeout=timeout,
            ):
                yield self._build_chunk(
                    event=event,
                    model=model,
                )

        except Exception as error:
            yield self._build_error_chunk(
                self._friendly_error(error),
                model=model,
            )

    def _build_chunk(
        self,
        *,
        event: dict[str, Any],
        model: str,
    ) -> ChatChunk:
        return ChatChunk(
            id=str(event.get("id") or ""),
            object=str(event.get("object") or "chat.completion.chunk"),
            created=int(event.get("created") or 0),
            model=str(event.get("model") or model),
            content=str(event.get("content") or ""),
            provider=str(event.get("provider") or self._provider),
            done=bool(event.get("done", False)),
            raw=event,
        )

    def _build_error_chunk(
        self,
        message: str,
        *,
        model: str,
    ) -> ChatChunk:
        return ChatChunk(
            id="",
            object="chat.completion.chunk",
            created=0,
            model=model,
            content=message,
            provider=self._provider,
            done=True,
            raw={
                "error": message,
                "provider": self._provider,
                "done": True,
            },
        )

    @staticmethod
    def _build_response(data: dict[str, Any]) -> ChatResponse:
        choices = data.get("choices") or []
        message = choices[0].get("message", {}) if choices else {}

        return ChatResponse(
            id=str(data.get("id") or ""),
            object=str(data.get("object") or "chat.completion"),
            created=int(data.get("created") or 0),
            model=str(data.get("model") or "chat-window"),
            content=message.get("content") or "",
            provider=str(data.get("provider") or ""),
            raw=data,
        )

    def _build_error_response(self, message: str) -> ChatResponse:
        return ChatResponse(
            id="",
            object="chat.completion",
            created=0,
            model="chat-window",
            content=message or DEFAULT_ERROR_MESSAGE,
            provider=self._provider,
            raw={
                "error": message or DEFAULT_ERROR_MESSAGE,
                "provider": self._provider,
            },
        )

    @staticmethod
    def _friendly_error(error: BaseException) -> str:
        if isinstance(error, ExtensionNotConnectedError):
            return "PairIt extension is not connected. First connect with the PairIt extension, then try again."

        if isinstance(error, PairitError):
            message = str(error).strip()
            return message or DEFAULT_ERROR_MESSAGE

        message = str(error).strip()
        if message:
            return message

        return DEFAULT_ERROR_MESSAGE

    # ================================================================
    # Close & Context Manager
    # ================================================================

    def close(self) -> None:
        if self._closed:
            return

        self._closed = True
        try:
            self._bridge.stop()
        except Exception:
            pass

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
