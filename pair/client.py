from __future__ import annotations

from typing import Any

from .bridge import BridgeServer
from .types import ChatResponse


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
        timeout: float | None = None,
    ) -> ChatResponse:
        """
        Send a prompt and return only after the provider finishes generating
        the complete response. No timeout is required for normal usage.
        """
        if self._closed:
            raise RuntimeError("PAIR client is closed.")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("prompt must be a non-empty string.")

        result = self._bridge.chat(
            provider=self._provider,
            messages=[{"role": "user", "content": prompt}],
            model=model,
            stream=False,
            timeout=timeout,
        )
        return self._build_response(result)

    def chat_messages(
        self,
        messages: list[dict[str, str]],
        *,
        model: str = "chat-window",
        timeout: float | None = None,
    ) -> ChatResponse:
        if self._closed:
            raise RuntimeError("PAIR client is closed.")
        if not isinstance(messages, list) or not messages:
            raise ValueError("messages must be a non-empty list.")

        result = self._bridge.chat(
            provider=self._provider,
            messages=messages,
            model=model,
            stream=False,
            timeout=timeout,
        )
        return self._build_response(result)

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
        self._bridge.stop()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
