import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from pairit.bridge import BridgeServer
from pairit.exceptions import (
    UnknownModelError,
    ModelNotDownloadedError,
    UnsupportedOperationError,
    ModelOutOfMemoryError,
    ModelBusyError,
    InvalidImageError,
    ModelRuntimeError,
    ModelLoadError,
    ModelDownloadError,
    ModelError,
)


class TestBridgeProtocol(unittest.TestCase):
    def setUp(self):
        self.bridge = BridgeServer(host="127.0.0.1", port=8765)
        # Mock loop and extension connection
        self.bridge._loop = MagicMock()
        self.bridge._loop.is_running.return_value = True
        self.bridge._send_to_extension = AsyncMock()

    @patch.object(BridgeServer, "extension_connected", True)
    @patch("asyncio.run_coroutine_threadsafe")
    def test_execute_model_request_success(self, mock_run_coro):
        # Setup mock send future
        send_future = MagicMock()
        send_future.result.return_value = None
        mock_run_coro.return_value = send_future

        # Simulate response in a thread/future
        def side_effect(coro, loop):
            # Resolve the pending future
            for req_id, fut in list(self.bridge._pending.items()):
                fut.set_result({
                    "type": "model_response",
                    "requestId": req_id,
                    "model": "qwen3-0.6b",
                    "operation": "chat",
                    "data": {"content": "Hello from mock", "backend": "webgpu"},
                })
            return send_future

        mock_run_coro.side_effect = side_effect

        data = self.bridge.execute_model_request(
            model="qwen3-0.6b",
            operation="chat",
            payload={"prompt": "hi"},
        )
        self.assertEqual(data["content"], "Hello from mock")
        self.assertEqual(data["backend"], "webgpu")

    @patch.object(BridgeServer, "extension_connected", True)
    @patch("asyncio.run_coroutine_threadsafe")
    def test_execute_model_request_error_mappings(self, mock_run_coro):
        error_cases = [
            ("unknown_model", UnknownModelError),
            ("model_not_downloaded", ModelNotDownloadedError),
            ("unsupported_operation", UnsupportedOperationError),
            ("model_out_of_memory", ModelOutOfMemoryError),
            ("model_busy", ModelBusyError),
            ("invalid_image", InvalidImageError),
            ("model_runtime_error", ModelRuntimeError),
            ("model_load_error", ModelLoadError),
            ("model_download_error", ModelDownloadError),
            ("other_code", ModelError),
        ]

        for code, expected_exc in error_cases:
            with self.subTest(code=code):
                send_future = MagicMock()
                send_future.result.return_value = None

                def make_side_effect(c):
                    def side_effect(coro, loop):
                        for req_id, fut in list(self.bridge._pending.items()):
                            fut.set_result({
                                "type": "model_error",
                                "requestId": req_id,
                                "model": "qwen3-0.6b",
                                "code": c,
                                "message": f"Simulated error {c}",
                            })
                        return send_future
                    return side_effect

                mock_run_coro.side_effect = make_side_effect(code)

                with self.assertRaises(expected_exc):
                    self.bridge.execute_model_request(
                        model="qwen3-0.6b",
                        operation="chat",
                        payload={"prompt": "hi"},
                    )

    def test_handle_model_response_dispatch(self):
        req_id = "test_req_1"
        fut = MagicMock()
        fut.done.return_value = False
        with self.bridge._pending_lock:
            self.bridge._pending[req_id] = fut

        msg = {
            "type": "model_response",
            "requestId": req_id,
            "model": "qwen3-0.6b",
            "data": {"content": "ok"},
        }

        import json

        # Dispatch message directly into _handle_extension_message
        asyncio.run(self.bridge._handle_extension_message(json.dumps(msg)))
        fut.set_result.assert_called_once_with(msg)


if __name__ == "__main__":
    unittest.main()
