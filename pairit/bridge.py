from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import uuid
from concurrent.futures import Future
from queue import Empty, Queue
from typing import Any

from aiohttp import web

from .exceptions import (
    ChatTimeoutError,
    ExtensionNotConnectedError,
    ProviderError,
    ProviderNotOpenError,
)

logger = logging.getLogger(__name__)

EXTENSION_CONNECT_WAIT_SECONDS = 10.0


PROVIDERS = {
    "chatgpt",
    "claude",
    "gemini",
}


class BridgeServer:
    """
    Local HTTP + WebSocket bridge.

    HTTP:
        http://127.0.0.1:8765/

    WebSocket:
        ws://127.0.0.1:8765/ws
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 8765,
    ) -> None:

        self.host = host
        self.port = port

        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None

        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None

        self._started = threading.Event()
        self._extension_connected = threading.Event()

        self._start_error: BaseException | None = None

        self._extension: web.WebSocketResponse | None = None

        self._extension_lock = threading.Lock()

        self._pending: dict[
            str,
            Future[dict[str, Any]],
        ] = {}

        self._pending_streams: dict[
            str,
            Queue[dict[str, Any]],
        ] = {}

        self._pending_lock = threading.Lock()

        self._chat_lock = threading.Lock()

        self._provider = "chatgpt"

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def extension_connected(self) -> bool:
        return self._extension_connected.is_set()

    @property
    def provider(self) -> str:
        return self._provider

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """
        Start the bridge in a background thread.
        """

        if (
            self._thread is not None
            and self._thread.is_alive()
        ):
            return

        self._started.clear()
        self._start_error = None

        self._thread = threading.Thread(
            target=self._run_loop,
            name="pairit-bridge",
            daemon=True,
        )

        self._thread.start()

        if not self._started.wait(timeout=5):
            raise RuntimeError(
                "pairit bridge did not start within 5 seconds."
            )

        if self._start_error is not None:
            raise RuntimeError(
                "Failed to start pairit bridge."
            ) from self._start_error

    def stop(self) -> None:
        """
        Stop the bridge.
        """

        loop = self._loop

        if loop is None or not loop.is_running():
            return

        future = asyncio.run_coroutine_threadsafe(
            self._shutdown(),
            loop,
        )

        try:
            future.result(timeout=5)
        except Exception:
            logger.exception(
                "Error while stopping pairit bridge."
            )

    def _run_loop(self) -> None:
        loop = asyncio.new_event_loop()

        self._loop = loop

        asyncio.set_event_loop(loop)

        try:
            loop.run_until_complete(
                self._start_server()
            )

            self._started.set()

            loop.run_forever()

        except BaseException as exc:
            self._start_error = exc
            self._started.set()

        finally:
            try:
                loop.run_until_complete(
                    self._shutdown()
                )
            except Exception:
                pass

            loop.close()

            self._loop = None

    async def _start_server(self) -> None:
        """
        Create HTTP routes and WebSocket endpoint.
        """

        app = web.Application()

        # --------------------------------------------------------------
        # Health / API routes
        # --------------------------------------------------------------

        app.router.add_route(
            "*",
            "/",
            self._handle_root,
        )

        app.router.add_route(
            "*",
            "/v1/models",
            self._handle_models,
        )

        app.router.add_route(
            "*",
            "/v1/provider",
            self._handle_provider,
        )

        app.router.add_route(
            "*",
            "/v1/chat/completions",
            self._handle_chat_completions,
        )

        # --------------------------------------------------------------
        # WebSocket
        # --------------------------------------------------------------

        app.router.add_get(
            "/ws",
            self._handle_websocket,
        )

        # --------------------------------------------------------------
        # CORS
        # --------------------------------------------------------------

        app.on_response_prepare.append(
            self._add_cors_headers
        )

        self._runner = web.AppRunner(
            app,
            access_log=None,
        )

        await self._runner.setup()

        self._site = web.TCPSite(
            self._runner,
            self.host,
            self.port,
        )

        await self._site.start()

        logger.info(
            "pairit bridge listening on http://%s:%s",
            self.host,
            self.port,
        )

        logger.info(
            "pairit WebSocket listening on ws://%s:%s/ws",
            self.host,
            self.port,
        )

    async def _shutdown(self) -> None:
        """
        Shutdown the HTTP/WebSocket server.
        """

        self._extension_connected.clear()

        with self._extension_lock:
            websocket = self._extension
            self._extension = None

        if websocket is not None:
            try:
                await websocket.close()
            except Exception:
                pass

        with self._pending_lock:
            pending = list(
                self._pending.values()
            )
            pending_streams = list(
                self._pending_streams.values()
            )

            self._pending.clear()
            self._pending_streams.clear()

        for future in pending:
            if not future.done():
                future.set_exception(
                    RuntimeError(
                        "pairit bridge stopped."
                    )
                )

        for stream_queue in pending_streams:
            stream_queue.put(
                {
                    "type": "chat_stream_error",
                    "error": "pairit bridge stopped.",
                }
            )

        if self._runner is not None:
            try:
                await self._runner.cleanup()
            except Exception:
                logger.exception(
                    "Failed to clean up pairit HTTP server."
                )

        self._runner = None
        self._site = None

    # ------------------------------------------------------------------
    # Provider
    # ------------------------------------------------------------------

    def set_provider(
        self,
        provider: str,
    ) -> None:

        provider = provider.lower().strip()

        if provider not in PROVIDERS:
            raise ValueError(
                "Unsupported provider. "
                "Use 'chatgpt', 'claude', or 'gemini'."
            )

        self._provider = provider

        loop = self._loop

        if (
            loop is not None
            and loop.is_running()
        ):
            asyncio.run_coroutine_threadsafe(
                self._send_provider_changed(
                    provider
                ),
                loop,
            )

    # ------------------------------------------------------------------
    # Wait for extension
    # ------------------------------------------------------------------

    def wait_for_extension(
        self,
        timeout: float | None = None,
    ) -> bool:
        """
        Wait until the Chrome extension connects.
        """

        return self._extension_connected.wait(
            timeout=timeout
        )

    # ------------------------------------------------------------------
    # Chat
    # ------------------------------------------------------------------

    def chat(
        self,
        *,
        provider: str,
        messages: list[dict[str, str]],
        model: str = "chat-window",
        stream: bool = False,
        timeout: float | None = None,
    ) -> dict[str, Any]:

        if stream:
            raise NotImplementedError(
                "Streaming is not implemented yet."
            )

        if provider not in PROVIDERS:
            raise ValueError(
                f"Unsupported provider: {provider}"
            )

        if not messages:
            raise ValueError(
                "messages must not be empty."
            )

        # --------------------------------------------------------------
        # Wait briefly for the PairIt extension to connect.
        # The extension may reconnect during this period.
        # Generation itself still has no default timeout.
        # --------------------------------------------------------------

        if not self.extension_connected:
            connected = self.wait_for_extension(
                timeout=EXTENSION_CONNECT_WAIT_SECONDS
            )

            if not connected:
                raise ExtensionNotConnectedError(
                    "PairIt extension is not connected. "
                    "First connect with the PairIt extension, "
                    "then try again."
                )

        # --------------------------------------------------------------
        # Only one browser chat operation at a time.
        # --------------------------------------------------------------

        with self._chat_lock:

            if not self.extension_connected:
                raise ExtensionNotConnectedError(
                    "PairIt extension is not connected. "
                    "First connect with the PairIt extension, "
                    "then try again."
                )

            request_id = (
                f"pairit_"
                f"{int(time.time() * 1000)}_"
                f"{uuid.uuid4().hex[:8]}"
            )

            future: Future[
                dict[str, Any]
            ] = Future()

            with self._pending_lock:
                self._pending[request_id] = future

            payload = {
                "type": "chat_request",
                "requestId": request_id,
                "provider": provider,
                "model": model,
                "messages": messages,
                "stream": False,
            }

            loop = self._loop

            if (
                loop is None
                or not loop.is_running()
            ):
                self._remove_pending(
                    request_id
                )

                raise RuntimeError(
                    "pairit bridge is not running."
                )

            send_future = (
                asyncio.run_coroutine_threadsafe(
                    self._send_to_extension(
                        payload
                    ),
                    loop,
                )
            )

            try:

                send_future.result(
                    timeout=5
                )

                # No default response timeout. This blocks until the
                # provider sends its complete/final response.
                result = future.result(
                    timeout=timeout
                )

            except TimeoutError as exc:

                if timeout is None:
                    raise

                raise ChatTimeoutError(
                    f"Timed out waiting for "
                    f"{provider} response after "
                    f"{timeout:.0f} seconds."
                ) from exc

            finally:

                self._remove_pending(
                    request_id
                )

            if result.get("error"):
                if result.get("errorCode") == "provider_not_open":
                    raise ProviderNotOpenError(
                        str(result["error"])
                    )

                raise ProviderError(
                    str(result["error"])
                )

            return {
                "id": request_id,
                "object": "chat.completion",
                "created": int(
                    time.time()
                ),
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": (
                                result.get(
                                    "content"
                                )
                                or ""
                            ),
                        },
                        "finish_reason": "stop",
                    }
                ],
                "provider": provider,
            }


    def chat_stream(
        self,
        *,
        provider: str,
        messages: list[dict[str, str]],
        model: str = "chat-window",
        timeout: float | None = None,
    ):
        """
        Stream incremental browser response chunks.

        pairit waits briefly for the extension to connect. Once the request is
        sent, there is no default generation timeout. If timeout is supplied,
        it applies to waiting for each stream event.
        """
        if provider not in PROVIDERS:
            raise ValueError(
                f"Unsupported provider: {provider}"
            )

        if not messages:
            raise ValueError(
                "messages must not be empty."
            )

        if not self.extension_connected:
            connected = self.wait_for_extension(
                timeout=EXTENSION_CONNECT_WAIT_SECONDS
            )

            if not connected:
                raise ExtensionNotConnectedError(
                    "PairIt extension is not connected. "
                    "First connect with the PairIt extension, "
                    "then try again."
                )

        with self._chat_lock:
            if not self.extension_connected:
                raise ExtensionNotConnectedError(
                    "PairIt extension is not connected. "
                    "First connect with the PairIt extension, "
                    "then try again."
                )

            request_id = (
                f"pairit_"
                f"{int(time.time() * 1000)}_"
                f"{uuid.uuid4().hex[:8]}"
            )

            stream_queue: Queue[dict[str, Any]] = Queue()

            with self._pending_lock:
                self._pending_streams[request_id] = stream_queue

            payload = {
                "type": "chat_request",
                "requestId": request_id,
                "provider": provider,
                "model": model,
                "messages": messages,
                "stream": True,
            }

            loop = self._loop

            if loop is None or not loop.is_running():
                self._remove_pending_stream(request_id)
                raise RuntimeError(
                    "pairit bridge is not running."
                )

            send_future = asyncio.run_coroutine_threadsafe(
                self._send_to_extension(payload),
                loop,
            )

            try:
                send_future.result(timeout=5)
            except Exception:
                self._remove_pending_stream(request_id)
                raise

            try:
                while True:
                    try:
                        event = stream_queue.get(
                            timeout=timeout
                        )
                    except Empty as exc:
                        if timeout is None:
                            raise

                        raise ChatTimeoutError(
                            f"Timed out waiting for "
                            f"{provider} stream after "
                            f"{timeout:.0f} seconds."
                        ) from exc

                    event_type = event.get("type")

                    if event_type == "chat_stream_error":
                        error = str(
                            event.get("error")
                            or f"{provider} streaming failed."
                        )

                        if event.get("errorCode") == "provider_not_open":
                            raise ProviderNotOpenError(error)

                        raise ProviderError(error)

                    if event_type != "chat_stream_chunk":
                        continue

                    if event.get("error"):
                        error = str(event["error"])

                        if event.get("errorCode") == "provider_not_open":
                            raise ProviderNotOpenError(error)

                        raise ProviderError(error)

                    yield {
                        "id": request_id,
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": model,
                        "content": str(
                            event.get("content") or ""
                        ),
                        "provider": provider,
                        "done": bool(
                            event.get("done", False)
                        ),
                    }

                    if event.get("done"):
                        break

            finally:
                self._remove_pending_stream(request_id)

    # ------------------------------------------------------------------
    # HTTP handlers
    # ------------------------------------------------------------------

    async def _handle_root(
        self,
        request: web.Request,
    ) -> web.Response:

        return self._json_response(
            {
                "name": "PairIt",
                "version": "0.4.2",
                "status": "running",
                "extensionConnected": (
                    self.extension_connected
                ),
                "activeProvider": self._provider,
            }
        )

    async def _handle_models(
        self,
        request: web.Request,
    ) -> web.Response:

        data = []

        for provider in (
            "chatgpt",
            "claude",
            "gemini",
        ):
            data.append(
                {
                    "id": provider,
                    "object": "model",
                    "created": 0,
                    "owned_by": provider,
                    "available": True,
                    "active": (
                        provider
                        == self._provider
                    ),
                }
            )

        return self._json_response(
            {
                "object": "list",
                "data": data,
            }
        )

    async def _handle_provider(
        self,
        request: web.Request,
    ) -> web.Response:

        if request.method == "OPTIONS":
            return self._json_response(
                {}
            )

        if request.method == "GET":

            return self._json_response(
                {
                    "active": self._provider,
                    "providers": [
                        {
                            "id": "chatgpt",
                            "name": "ChatGPT",
                            "available": True,
                            "active": (
                                self._provider
                                == "chatgpt"
                            ),
                        },
                        {
                            "id": "claude",
                            "name": "Claude",
                            "available": True,
                            "active": (
                                self._provider
                                == "claude"
                            ),
                        },
                        {
                            "id": "gemini",
                            "name": "Gemini",
                            "available": True,
                            "active": (
                                self._provider
                                == "gemini"
                            ),
                        },
                    ],
                }
            )

        if request.method != "POST":
            return self._json_response(
                {
                    "error": {
                        "message": (
                            "Method not allowed."
                        ),
                        "type": (
                            "invalid_request_error"
                        ),
                    }
                },
                status=405,
            )

        try:
            body = await request.json()

        except Exception:
            return self._json_response(
                {
                    "error": {
                        "message": (
                            "Request body must "
                            "be valid JSON."
                        ),
                        "type": (
                            "invalid_request_error"
                        ),
                    }
                },
                status=400,
            )

        provider = (
            body.get("provider")
            if isinstance(body, dict)
            else None
        )

        if provider not in PROVIDERS:
            return self._json_response(
                {
                    "error": {
                        "message": (
                            "provider must be "
                            "chatgpt, claude, "
                            "or gemini."
                        ),
                        "type": (
                            "invalid_request_error"
                        ),
                    }
                },
                status=400,
            )

        self.set_provider(
            provider
        )

        return self._json_response(
            {
                "success": True,
                "active": provider,
            }
        )

    async def _handle_chat_completions(
        self,
        request: web.Request,
    ) -> web.Response:

        if request.method == "OPTIONS":
            return self._json_response(
                {}
            )

        if request.method != "POST":
            return self._json_response(
                {
                    "error": {
                        "message": (
                            "Method not allowed."
                        ),
                        "type": (
                            "invalid_request_error"
                        ),
                    }
                },
                status=405,
            )

        try:
            body = await request.json()

        except Exception:
            return self._json_response(
                {
                    "error": {
                        "message": (
                            "Request body must "
                            "be valid JSON."
                        ),
                        "type": (
                            "invalid_request_error"
                        ),
                    }
                },
                status=400,
            )

        if not isinstance(body, dict):
            return self._json_response(
                {
                    "error": {
                        "message": (
                            "Request body must "
                            "be an object."
                        ),
                        "type": (
                            "invalid_request_error"
                        ),
                    }
                },
                status=400,
            )

        messages = body.get(
            "messages"
        )

        if (
            not isinstance(messages, list)
            or not messages
        ):
            return self._json_response(
                {
                    "error": {
                        "message": (
                            "messages must be "
                            "a non-empty array."
                        ),
                        "type": (
                            "invalid_request_error"
                        ),
                    }
                },
                status=400,
            )

        provider = (
            body.get("provider")
            or self._provider
        )

        if provider not in PROVIDERS:
            return self._json_response(
                {
                    "error": {
                        "message": (
                            "provider must be "
                            "chatgpt, claude, "
                            "or gemini."
                        ),
                        "type": (
                            "invalid_request_error"
                        ),
                    }
                },
                status=400,
            )

        model = (
            body.get("model")
            or "chat-window"
        )

        stream = bool(
            body.get("stream", False)
        )

        if stream:
            return self._json_response(
                {
                    "error": {
                        "message": (
                            "Streaming is not "
                            "implemented yet."
                        ),
                        "type": (
                            "unsupported_feature"
                        ),
                    }
                },
                status=400,
            )

        try:

            result = self.chat(
                provider=provider,
                messages=messages,
                model=model,
                stream=False,
                timeout=None,
            )

            return self._json_response(
                result
            )

        except ExtensionNotConnectedError as exc:

            return self._json_response(
                {
                    "error": {
                        "message": str(exc),
                        "type": (
                            "bridge_error"
                        ),
                        "provider": provider,
                    }
                },
                status=503,
            )

        except ProviderNotOpenError as exc:

            return self._json_response(
                {
                    "error": {
                        "message": str(exc),
                        "type": "provider_not_open",
                        "provider": provider,
                    }
                },
                status=404,
            )

        except ProviderError as exc:

            return self._json_response(
                {
                    "error": {
                        "message": str(exc),
                        "type": (
                            "provider_error"
                        ),
                        "provider": provider,
                    }
                },
                status=500,
            )

        except ChatTimeoutError as exc:

            return self._json_response(
                {
                    "error": {
                        "message": str(exc),
                        "type": (
                            "bridge_timeout"
                        ),
                        "provider": provider,
                    }
                },
                status=504,
            )

        except Exception as exc:

            logger.exception(
                "Chat completion failed."
            )

            return self._json_response(
                {
                    "error": {
                        "message": str(exc),
                        "type": (
                            "bridge_error"
                        ),
                        "provider": provider,
                    }
                },
                status=500,
            )

    # ------------------------------------------------------------------
    # WebSocket
    # ------------------------------------------------------------------

    async def _handle_websocket(
        self,
        request: web.Request,
    ) -> web.WebSocketResponse:

        websocket = web.WebSocketResponse(
            heartbeat=20,
            max_msg_size=2 * 1024 * 1024,
        )

        await websocket.prepare(
            request
        )

        with self._extension_lock:

            old = self._extension

            self._extension = websocket

            self._extension_connected.set()

        if (
            old is not None
            and not old.closed
        ):
            try:
                await old.close()
            except Exception:
                pass

        logger.info(
            "PairIt extension connected."
        )

        try:

            await self._send_provider_changed(
                self._provider
            )

            async for message in websocket:

                if message.type == web.WSMsgType.TEXT:

                    await self._handle_extension_message(
                        message.data
                    )

                elif message.type == web.WSMsgType.ERROR:

                    logger.error(
                        "WebSocket error: %s",
                        websocket.exception(),
                    )

                    break

                elif message.type in (
                    web.WSMsgType.CLOSE,
                    web.WSMsgType.CLOSED,
                    web.WSMsgType.CLOSING,
                ):
                    break

        except Exception:

            logger.exception(
                "Chrome extension WebSocket error."
            )

        finally:

            with self._extension_lock:

                if (
                    self._extension
                    is websocket
                ):
                    self._extension = None
                    self._extension_connected.clear()

            logger.info(
                "PairIt extension disconnected."
            )

        return websocket

    async def _handle_extension_message(
        self,
        raw_message: str,
    ) -> None:

        try:
            message = json.loads(
                raw_message
            )

        except json.JSONDecodeError:

            logger.warning(
                "Ignoring invalid extension message."
            )

            return

        if not isinstance(
            message,
            dict,
        ):
            return

        message_type = message.get(
            "type"
        )

        # --------------------------------------------------------------
        # Extension ready
        # --------------------------------------------------------------

        if message_type == "extension_ready":

            self._extension_connected.set()

            await self._send_provider_changed(
                self._provider
            )

            logger.info(
                "PairIt extension is ready."
            )

            return

        # --------------------------------------------------------------
        # Provider changed
        # --------------------------------------------------------------

        if message_type == "provider_changed":

            provider = message.get(
                "provider"
            )

            if provider in PROVIDERS:
                self._provider = provider

            return

        # --------------------------------------------------------------
        # Chat stream chunk
        # --------------------------------------------------------------

        if message_type == "chat_stream_chunk":
            request_id = message.get("requestId")

            if not request_id:
                return

            with self._pending_lock:
                stream_queue = self._pending_streams.get(
                    request_id
                )

            if stream_queue is not None:
                stream_queue.put(message)

            return

        # --------------------------------------------------------------
        # Chat stream error
        # --------------------------------------------------------------

        if message_type == "chat_stream_error":
            request_id = message.get("requestId")

            if not request_id:
                return

            with self._pending_lock:
                stream_queue = self._pending_streams.get(
                    request_id
                )

            if stream_queue is not None:
                stream_queue.put(message)

            return

        # --------------------------------------------------------------
        # Chat response
        # --------------------------------------------------------------

        if message_type == "chat_response":

            request_id = message.get(
                "requestId"
            )

            if not request_id:
                return

            # A provider-not-open/provider-error response is sent as a
            # normal chat_response by the extension. Streaming requests use
            # a Queue instead of a Future, so route chat_response messages
            # into the matching stream queue as well.
            with self._pending_lock:
                stream_queue = self._pending_streams.get(
                    request_id
                )
                future = self._pending.get(
                    request_id
                )

            if stream_queue is not None:
                if message.get("error"):
                    stream_queue.put({
                        "type": "chat_stream_error",
                        "requestId": request_id,
                        "provider": message.get("provider"),
                        "error": message.get("error"),
                        "errorCode": message.get("errorCode"),
                    })
                else:
                    stream_queue.put({
                        "type": "chat_stream_chunk",
                        "requestId": request_id,
                        "provider": message.get("provider"),
                        "content": message.get("content") or "",
                        "done": True,
                    })

                return

            if (
                future is not None
                and not future.done()
            ):
                future.set_result(
                    message
                )

            return

        # --------------------------------------------------------------
        # Pong
        # --------------------------------------------------------------

        if message_type == "pong":
            return

    # ------------------------------------------------------------------
    # WebSocket send helpers
    # ------------------------------------------------------------------

    async def _send_to_extension(
        self,
        payload: dict[str, Any],
    ) -> None:

        with self._extension_lock:
            websocket = self._extension

        if (
            websocket is None
            or websocket.closed
        ):
            raise ExtensionNotConnectedError(
                "PairIt extension is not connected."
            )

        await websocket.send_str(
            json.dumps(payload)
        )

    async def _send_provider_changed(
        self,
        provider: str,
    ) -> None:

        if not self.extension_connected:
            return

        try:

            await self._send_to_extension(
                {
                    "type": "provider_changed",
                    "provider": provider,
                }
            )

        except Exception:

            logger.debug(
                "Could not send provider change.",
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _remove_pending(
        self,
        request_id: str,
    ) -> None:

        with self._pending_lock:
            self._pending.pop(
                request_id,
                None,
            )

    def _remove_pending_stream(
        self,
        request_id: str,
    ) -> None:

        with self._pending_lock:
            self._pending_streams.pop(
                request_id,
                None,
            )

    @staticmethod
    async def _add_cors_headers(
        request: web.Request,
        response: web.StreamResponse,
    ) -> None:

        response.headers[
            "Access-Control-Allow-Origin"
        ] = "*"

        response.headers[
            "Access-Control-Allow-Methods"
        ] = "GET, POST, OPTIONS"

        response.headers[
            "Access-Control-Allow-Headers"
        ] = "Content-Type, Authorization"

    @staticmethod
    def _json_response(
        data: dict[str, Any],
        status: int = 200,
    ) -> web.Response:

        return web.json_response(
            data,
            status=status,
        )