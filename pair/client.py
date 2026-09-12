from __future__ import annotations

from typing import Any

from .bridge import BridgeServer
from .exceptions import (
    BridgeNotRunningError,
)
from .types import ChatResponse


class Client:
    """
    Public Python client for Pair.

    Example:

        from pair import Client

        client = Client(provider="chatgpt")

        response = client.chat(
            "Explain RAG in simple terms"
        )

        print(response.content)

        client.close()
    """

    SUPPORTED_PROVIDERS = {
        "chatgpt",
        "claude",
        "gemini",
    }

    def __init__(
        self,
        provider: str = "chatgpt",
        host: str = "127.0.0.1",
        port: int = 8765,
    ) -> None:
        provider = provider.lower().strip()

        if provider not in self.SUPPORTED_PROVIDERS:
            raise ValueError(
                "Unsupported provider. "
                "Use 'chatgpt', 'claude', or 'gemini'."
            )

        self.provider = provider

        self.bridge = BridgeServer(
            host=host,
            port=port,
        )

        try:
            self.bridge.start()
        except Exception as exc:
            raise BridgeNotRunningError(
                "Failed to start the Pair local bridge."
            ) from exc

        self.bridge.set_provider(
            self.provider
        )

    # ------------------------------------------------------------------
    # Provider
    # ------------------------------------------------------------------

    def set_provider(
        self,
        provider: str,
    ) -> None:
        """
        Change the active browser AI provider.

        Supported providers:
            - chatgpt
            - claude
            - gemini
        """

        provider = provider.lower().strip()

        if provider not in self.SUPPORTED_PROVIDERS:
            raise ValueError(
                "Unsupported provider. "
                "Use 'chatgpt', 'claude', or 'gemini'."
            )

        self.provider = provider

        self.bridge.set_provider(
            provider
        )

    # ------------------------------------------------------------------
    # Extension
    # ------------------------------------------------------------------

    @property
    def extension_connected(self) -> bool:
        """
        Return True when the Chrome extension is connected.
        """

        return self.bridge.extension_connected

    def wait_for_extension(
        self,
        timeout: float = 15.0,
    ) -> bool:
        """
        Wait for the Chrome extension to connect.

        Returns:
            True if connected within the timeout.
            False otherwise.
        """

        return self.bridge.wait_for_extension(
            timeout=timeout
        )

    # ------------------------------------------------------------------
    # Chat
    # ------------------------------------------------------------------

    def chat(
        self,
        prompt: str,
        *,
        model: str = "chat-window",
        timeout: float = 120.0,
    ) -> ChatResponse:
        """
        Send a prompt to the selected browser AI provider.

        Args:
            prompt:
                User's message.

            model:
                Model label returned in the response.
                The browser UI remains responsible for the
                actual model/session being used.

            timeout:
                Maximum time to wait for the browser response.

        Returns:
            ChatResponse
        """

        if not isinstance(prompt, str):
            raise TypeError(
                "prompt must be a string."
            )

        prompt = prompt.strip()

        if not prompt:
            raise ValueError(
                "prompt must not be empty."
            )

        result = self.bridge.chat(
            provider=self.provider,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            model=model,
            stream=False,
            timeout=timeout,
        )

        return self._build_response(
            result=result,
            provider=self.provider,
            model=model,
        )

    # ------------------------------------------------------------------
    # OpenAI-style messages API
    # ------------------------------------------------------------------

    def chat_messages(
        self,
        messages: list[dict[str, str]],
        *,
        model: str = "chat-window",
        timeout: float = 120.0,
    ) -> ChatResponse:
        """
        Send a list of chat messages.

        Example:

            response = client.chat_messages(
                [
                    {
                        "role": "system",
                        "content": "You are a helpful assistant.",
                    },
                    {
                        "role": "user",
                        "content": "Explain RAG.",
                    },
                ]
            )
        """

        if not isinstance(messages, list):
            raise TypeError(
                "messages must be a list."
            )

        if not messages:
            raise ValueError(
                "messages must not be empty."
            )

        normalized_messages: list[
            dict[str, str]
        ] = []

        for message in messages:

            if not isinstance(message, dict):
                raise TypeError(
                    "Each message must be a dictionary."
                )

            role = message.get("role")
            content = message.get("content")

            if not isinstance(role, str):
                raise TypeError(
                    "Each message must contain a "
                    "string 'role'."
                )

            if not isinstance(content, str):
                raise TypeError(
                    "Each message must contain a "
                    "string 'content'."
                )

            normalized_messages.append(
                {
                    "role": role,
                    "content": content,
                }
            )

        result = self.bridge.chat(
            provider=self.provider,
            messages=normalized_messages,
            model=model,
            stream=False,
            timeout=timeout,
        )

        return self._build_response(
            result=result,
            provider=self.provider,
            model=model,
        )

    # ------------------------------------------------------------------
    # Response handling
    # ------------------------------------------------------------------

    @staticmethod
    def _build_response(
        *,
        result: dict[str, Any],
        provider: str,
        model: str,
    ) -> ChatResponse:
        """
        Convert the bridge response into ChatResponse.
        """

        if not isinstance(result, dict):
            raise TypeError(
                "Bridge returned an invalid response."
            )

        choices = result.get(
            "choices",
            [],
        )

        content = ""

        if isinstance(choices, list) and choices:

            first_choice = choices[0]

            if isinstance(
                first_choice,
                dict,
            ):
                message = first_choice.get(
                    "message",
                    {},
                )

                if isinstance(
                    message,
                    dict,
                ):
                    content = (
                        message.get(
                            "content"
                        )
                        or ""
                    )

        return ChatResponse(
            id=str(
                result.get(
                    "id",
                    "",
                )
            ),
            object=str(
                result.get(
                    "object",
                    "chat.completion",
                )
            ),
            created=int(
                result.get(
                    "created",
                    0,
                )
            ),
            model=str(
                result.get(
                    "model",
                    model,
                )
            ),
            content=str(content),
            provider=str(
                result.get(
                    "provider",
                    provider,
                )
            ),
            raw=result,
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """
        Stop the local Pair bridge.
        """

        self.bridge.stop()

    def __enter__(self) -> "Client":
        return self

    def __exit__(
        self,
        exc_type: Any,
        exc_value: Any,
        traceback: Any,
    ) -> None:
        self.close()