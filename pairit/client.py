from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from .bridge import BridgeServer
from .exceptions import PairError, PairitError
from .types import ChatChunk, ChatResponse


SUPPORTED_PROVIDERS = {
    "chatgpt",
    "claude",
    "gemini",
}


DEFAULT_ERROR_MESSAGE = (
    "pairit could not complete the request. "
    "Check that the pairit extension is connected and the selected "
    "AI provider is open in a browser tab, then try again."
)


class Client:
    """Public pairit client."""

    def __init__(
        self,
        provider: str = "chatgpt",
        *,
        host: str = "127.0.0.1",
        port: int = 8765,
    ) -> None:
        provider = self._normalize_provider(provider)

        self._provider = provider
        self._bridge = BridgeServer(
            host=host,
            port=port,
        )
        self._closed = False
        self._init_error: str | None = None

        try:
            self._bridge.start()
            self._bridge.set_provider(provider)
        except Exception as error:
            # Keep Client construction safe. A later chat() call returns a
            # normal PAIR response instead of exposing the startup exception.
            self._init_error = self._friendly_error(error)

    # ================================================================
    # Provider
    # ================================================================

    @staticmethod
    def _normalize_provider(provider: str) -> str:
        if not isinstance(provider, str):
            raise ValueError("provider must be a string.")

        provider = provider.lower().strip()

        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError(
                "Unsupported provider. Use 'chatgpt', 'claude', or 'gemini'."
            )

        return provider

    @property
    def provider(self) -> str:
        return self._provider

    @property
    def extension_connected(self) -> bool:
        try:
            return self._bridge.extension_connected
        except Exception:
            return False

    def set_provider(self, provider: str) -> None:
        provider = self._normalize_provider(provider)
        self._provider = provider

        try:
            self._bridge.set_provider(provider)
            self._init_error = None
        except Exception as error:
            self._init_error = self._friendly_error(error)

    # ================================================================
    # Extension connection
    # ================================================================

    def wait_for_extension(
        self,
        timeout: float | None = 10.0,
    ) -> bool:
        """
        Wait briefly for the PAIR extension.

        A default finite connection wait prevents an application from
        hanging forever when the extension has not been connected.
        """
        try:
            return self._bridge.wait_for_extension(
                timeout=timeout
            )
        except Exception:
            return False

    # ================================================================
    # Chat
    # ================================================================

    def chat(
        self,
        prompt: str,
        *,
        model: str = "chat-window",
        stream: bool = False,
        timeout: float | None = None,
    ) -> ChatResponse | Iterator[ChatChunk]:
        """
        Send a chat request.

        Runtime PAIR errors are converted into normal responses/chunks so
        application code does not need to catch PAIR exceptions.
        """
        if self._closed:
            return self._build_error_response(
                "PAIR client is closed."
            )

        if not isinstance(prompt, str) or not prompt.strip():
            return self._build_error_response(
                "prompt must be a non-empty string."
            )

        messages = [
            {
                "role": "user",
                "content": prompt,
            }
        ]

        if stream:
            return self._stream_chat(
                messages,
                model=model,
                timeout=timeout,
            )

        try:
            if self._init_error:
                return self._build_error_response(
                    self._init_error
                )

            result = self._bridge.chat(
                provider=self._provider,
                messages=messages,
                model=model,
                stream=False,
                timeout=timeout,
            )

            return self._build_response(result)

        except Exception as error:
            return self._build_error_response(
                self._friendly_error(error)
            )

    # ================================================================
    # Chat messages
    # ================================================================

    def chat_messages(
        self,
        messages: list[dict[str, str]],
        *,
        model: str = "chat-window",
        stream: bool = False,
        timeout: float | None = None,
    ) -> ChatResponse | Iterator[ChatChunk]:
        """Send chat messages without exposing runtime exceptions."""
        if self._closed:
            return self._build_error_response(
                "PAIR client is closed."
            )

        if not isinstance(messages, list) or not messages:
            return self._build_error_response(
                "messages must be a non-empty list."
            )

        if stream:
            return self._stream_chat(
                messages,
                model=model,
                timeout=timeout,
            )

        try:
            if self._init_error:
                return self._build_error_response(
                    self._init_error
                )

            result = self._bridge.chat(
                provider=self._provider,
                messages=messages,
                model=model,
                stream=False,
                timeout=timeout,
            )

            return self._build_response(result)

        except Exception as error:
            return self._build_error_response(
                self._friendly_error(error)
            )

    # ================================================================
    # Streaming
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

    # ================================================================
    # Response builders
    # ================================================================

    def _build_chunk(
        self,
        *,
        event: dict[str, Any],
        model: str,
    ) -> ChatChunk:
        return ChatChunk(
            id=str(event.get("id") or ""),
            object=str(
                event.get("object")
                or "chat.completion.chunk"
            ),
            created=int(event.get("created") or 0),
            model=str(event.get("model") or model),
            content=str(event.get("content") or ""),
            provider=str(
                event.get("provider")
                or self._provider
            ),
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
    def _build_response(
        data: dict[str, Any],
    ) -> ChatResponse:
        choices = data.get("choices") or []
        message = (
            choices[0].get("message", {})
            if choices
            else {}
        )

        return ChatResponse(
            id=str(data.get("id") or ""),
            object=str(
                data.get("object")
                or "chat.completion"
            ),
            created=int(data.get("created") or 0),
            model=str(
                data.get("model")
                or "chat-window"
            ),
            content=message.get("content") or "",
            provider=str(data.get("provider") or ""),
            raw=data,
        )

    def _build_error_response(
        self,
        message: str,
    ) -> ChatResponse:
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
        if isinstance(error, PairError):
            message = str(error).strip()
            return message or DEFAULT_ERROR_MESSAGE

        message = str(error).strip()

        if message:
            return message

        return DEFAULT_ERROR_MESSAGE

    # ================================================================
    # Close
    # ================================================================

    def close(self) -> None:
        if self._closed:
            return

        self._closed = True

        try:
            self._bridge.stop()
        except Exception:
            pass

    # ================================================================
    # Context manager
    # ================================================================

    def __enter__(self) -> "Client":
        return self

    def __exit__(
        self,
        exc_type,
        exc,
        tb,
    ) -> None:
        self.close()
