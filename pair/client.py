from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from .bridge import BridgeServer
from .exceptions import PairError
from .types import ChatChunk, ChatResponse


SUPPORTED_PROVIDERS = {"chatgpt", "claude", "gemini"}


class Client:
    """Public PAIR client."""

    def __init__(
        self,
        provider: str = "chatgpt",
        *,
        host: str = "127.0.0.1",
        port: int = 8765,
    ) -> None:
        provider = provider.lower().strip()
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError(
                "Unsupported provider. Use 'chatgpt', 'claude', or 'gemini'."
            )

        self._provider = provider
        self._bridge = BridgeServer(host=host, port=port)
        self._closed = False

        self._bridge.start()
        self._bridge.set_provider(provider)

    @property
    def provider(self) -> str:
        return self._provider

    @property
    def extension_connected(self) -> bool:
        return self._bridge.extension_connected

    def set_provider(self, provider: str) -> None:
        provider = provider.lower().strip()
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError(
                "Unsupported provider. Use 'chatgpt', 'claude', or 'gemini'."
            )

        self._provider = provider
        self._bridge.set_provider(provider)

    def wait_for_extension(self, timeout: float | None = None) -> bool:
        """Wait for the PAIR extension; by default wait indefinitely."""
        return self._bridge.wait_for_extension(timeout=timeout)

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

        stream=False:
            Return the complete response after generation finishes.

        stream=True:
            Return an iterator that yields ChatChunk objects as the browser
            response grows. The iterator ends with a chunk whose done=True.
        """
        if self._closed:
            raise RuntimeError("PAIR client is closed.")

        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("prompt must be a non-empty string.")

        messages = [{"role": "user", "content": prompt}]

        if stream:
            return self._stream_chat(
                messages,
                model=model,
                timeout=timeout,
            )

        try:
            result = self._bridge.chat(
                provider=self._provider,
                messages=messages,
                model=model,
                stream=False,
                timeout=timeout,
            )
            return self._build_response(result)
        except PairError as error:
            return self._build_error_response(str(error))

    def chat_messages(
        self,
        messages: list[dict[str, str]],
        *,
        model: str = "chat-window",
        stream: bool = False,
        timeout: float | None = None,
    ) -> ChatResponse | Iterator[ChatChunk]:
        if self._closed:
            raise RuntimeError("PAIR client is closed.")

        if not isinstance(messages, list) or not messages:
            raise ValueError("messages must be a non-empty list.")

        if stream:
            return self._stream_chat(
                messages,
                model=model,
                timeout=timeout,
            )

        try:
            result = self._bridge.chat(
                provider=self._provider,
                messages=messages,
                model=model,
                stream=False,
                timeout=timeout,
            )
            return self._build_response(result)
        except PairError as error:
            return self._build_error_response(str(error))

    def _stream_chat(
        self,
        messages: list[dict[str, str]],
        *,
        model: str,
        timeout: float | None,
    ) -> Iterator[ChatChunk]:
        try:
            for event in self._bridge.chat_stream(
                provider=self._provider,
                messages=messages,
                model=model,
                timeout=timeout,
            ):
                yield ChatChunk(
                    id=str(event.get("id") or ""),
                    object=str(
                        event.get("object") or "chat.completion.chunk"
                    ),
                    created=int(event.get("created") or 0),
                    model=str(event.get("model") or model),
                    content=str(event.get("content") or ""),
                    provider=str(event.get("provider") or self._provider),
                    done=bool(event.get("done", False)),
                    raw=event,
                )
        except PairError as error:
            error_message = str(error)
            error_code = (
                "provider_not_open"
                if "is not open" in error_message
                else "pair_error"
            )

            yield ChatChunk(
                id="",
                object="chat.completion.chunk",
                created=0,
                model=model,
                content=error_message,
                provider=self._provider,
                done=False,
                raw={
                    "error": error_message,
                    "errorCode": error_code,
                    "provider": self._provider,
                },
            )

            yield ChatChunk(
                id="",
                object="chat.completion.chunk",
                created=0,
                model=model,
                content="",
                provider=self._provider,
                done=True,
                raw={
                    "error": error_message,
                    "errorCode": error_code,
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

    def close(self) -> None:
        if self._closed:
            return

        self._closed = True

        try:
            self._bridge.stop()
        except Exception:
            # Closing should remain safe if the bridge is already stopped.
            pass

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
