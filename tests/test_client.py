import base64
import unittest
import warnings
from unittest.mock import MagicMock, patch
from pairit.client import Client
from pairit.exceptions import (
    UnknownModelError,
    UnsupportedOperationError,
    InvalidImageError,
)
from pairit.types import ChatResponse, EmbeddingResponse

warnings.filterwarnings("ignore", category=RuntimeWarning)


class TestClient(unittest.TestCase):
    @patch("pairit.client.BridgeServer")
    def test_init_stateful(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge_cls.return_value = mock_bridge

        client = Client("chatgpt")
        self.assertEqual(client.model, "chatgpt")
        self.assertEqual(client.provider, "chatgpt")
        self.assertEqual(client.model_type, "stateful")
        self.assertEqual(client.capabilities, {"chat"})
        mock_bridge.start.assert_called_once()
        mock_bridge.set_provider.assert_called_with("chatgpt")

    @patch("pairit.client.BridgeServer")
    def test_init_backward_compat(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge_cls.return_value = mock_bridge

        client = Client(provider="claude")
        self.assertEqual(client.model, "claude")
        self.assertEqual(client.provider, "claude")
        self.assertEqual(client.model_type, "stateful")

    @patch("pairit.client.BridgeServer")
    def test_init_stateless_llm(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge_cls.return_value = mock_bridge

        client = Client("qwen3-0.6b")
        self.assertEqual(client.model, "qwen3-0.6b")
        self.assertEqual(client.provider, "stateless")
        self.assertEqual(client.model_type, "llm")
        self.assertEqual(client.capabilities, {"chat"})
        mock_bridge.start.assert_called_once()
        # set_provider shouldn't be called for stateless models
        mock_bridge.set_provider.assert_not_called()

    @patch("pairit.client.BridgeServer")
    def test_init_stateless_embedding(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge_cls.return_value = mock_bridge

        client = Client("all-minilm-l6-v2")
        self.assertEqual(client.model, "all-minilm-l6-v2")
        self.assertEqual(client.model_type, "embedding")
        self.assertEqual(client.capabilities, {"embed"})

    @patch("pairit.client.BridgeServer")
    def test_init_stateless_llm_smollm2(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge_cls.return_value = mock_bridge

        client = Client("smollm2-360m")
        self.assertEqual(client.model, "smollm2-360m")
        self.assertEqual(client.provider, "stateless")
        self.assertEqual(client.model_type, "llm")
        self.assertEqual(client.capabilities, {"chat"})

    @patch("pairit.client.BridgeServer")
    def test_init_stateless_vlm(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge_cls.return_value = mock_bridge

        client = Client("smolvlm-500m")
        self.assertEqual(client.model, "smolvlm-500m")
        self.assertEqual(client.model_type, "vlm")
        self.assertEqual(client.capabilities, {"vision"})

    def test_init_unknown_model(self):
        with self.assertRaises(UnknownModelError):
            Client("gpt-5-turbo-ultra")

    def test_init_no_model_raises_with_helpful_message(self):
        with self.assertRaises(TypeError) as ctx:
            Client()
        msg = str(ctx.exception)
        self.assertIn("Client() requires a model name", msg)
        self.assertIn("qwen3-0.6b", msg)
        self.assertIn("chatgpt", msg)
        self.assertIn("all-minilm-l6-v2", msg)
        self.assertIn("smolvlm-500m", msg)

    @patch("pairit.client.BridgeServer")
    def test_stateless_chat_execution(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge.execute_model_request.return_value = {
            "content": "Paris is the capital of France.",
            "backend": "webgpu",
        }
        mock_bridge_cls.return_value = mock_bridge

        client = Client("qwen3-0.6b")
        response = client.chat("What is the capital of France?")
        self.assertIsInstance(response, ChatResponse)
        self.assertEqual(response.content, "Paris is the capital of France.")
        self.assertEqual(response.model, "qwen3-0.6b")
        mock_bridge.execute_model_request.assert_called_once_with(
            model="qwen3-0.6b",
            operation="chat",
            payload={
                "messages": [{"role": "user", "content": "What is the capital of France?"}],
                "prompt": "What is the capital of France?",
            },
            timeout=None,
        )

    @patch("pairit.client.BridgeServer")
    def test_stateless_embed_execution(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge.execute_model_request.return_value = {
            "vectors": [[0.1, 0.2, 0.3]],
            "dimensions": 3,
            "backend": "wasm",
        }
        mock_bridge_cls.return_value = mock_bridge

        client = Client("all-minilm-l6-v2")
        response = client.embed("test text")
        self.assertIsInstance(response, EmbeddingResponse)
        self.assertEqual(response.vectors, [[0.1, 0.2, 0.3]])
        self.assertEqual(response.dimensions, 3)
        self.assertEqual(response.backend, "wasm")

    @patch("pairit.client.BridgeServer")
    def test_stateless_vision_execution(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge.execute_model_request.return_value = {
            "content": "A picture of a cute cat.",
            "backend": "webgpu",
        }
        mock_bridge_cls.return_value = mock_bridge

        client = Client("smolvlm-500m")
        # 1x1 transparent PNG
        tiny_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82"
        response = client.vision(tiny_png, "What is this?")
        self.assertIsInstance(response, ChatResponse)
        self.assertEqual(response.content, "A picture of a cute cat.")

    @patch("pairit.client.BridgeServer")
    def test_operation_capability_checks(self, mock_bridge_cls):
        mock_bridge = MagicMock()
        mock_bridge_cls.return_value = mock_bridge

        # Embedding model cannot chat
        embed_client = Client("all-minilm-l6-v2")
        with self.assertRaises(UnsupportedOperationError):
            embed_client.chat("Hello")

        # Chat model cannot embed
        chat_client = Client("qwen3-0.6b")
        with self.assertRaises(UnsupportedOperationError):
            chat_client.embed("Hello")

        # Chat model cannot vision
        with self.assertRaises(UnsupportedOperationError):
            chat_client.vision(b"fake", "Hello")

    @patch("pairit.client.BridgeServer")
    def test_image_payload_validation(self, mock_bridge_cls):
        client = Client("smolvlm-500m")

        # Invalid type
        with self.assertRaises(InvalidImageError):
            client._prepare_image_payload(12345)

        # Nonexistent file
        with self.assertRaises(InvalidImageError):
            client._prepare_image_payload("nonexistent_image_file.png")

        # Valid data URL passes through
        data_url = "data:image/png;base64,iVBORw0KGgo="
        self.assertEqual(client._prepare_image_payload(data_url), data_url)

    @patch("pairit.client.BridgeServer")
    def test_extension_not_connected_for_all_models(self, mock_bridge_cls):
        from pairit.exceptions import ExtensionNotConnectedError
        mock_bridge = MagicMock()
        mock_bridge.chat.side_effect = ExtensionNotConnectedError(
            "PairIt extension is not connected. First connect with the PairIt extension, then try again."
        )
        mock_bridge.execute_model_request.side_effect = ExtensionNotConnectedError(
            "PairIt extension is not connected. First connect with the PairIt extension, then try again."
        )
        mock_bridge_cls.return_value = mock_bridge

        expected_msg = "PairIt extension is not connected. First connect with the PairIt extension, then try again."

        # 1. Stateful Model (e.g. chatgpt)
        stateful_client = Client("chatgpt")
        resp1 = stateful_client.chat("Hello")
        self.assertEqual(resp1.content, expected_msg)

        # 2. Stateless LLM (e.g. qwen3-0.6b)
        stateless_client = Client("qwen3-0.6b")
        resp2 = stateless_client.chat("Hello")
        self.assertEqual(resp2.content, expected_msg)

        # 3. Vision Model (e.g. smolvlm-500m)
        tiny_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82"
        vlm_client = Client("smolvlm-500m")
        resp3 = vlm_client.vision(tiny_png, "What is this?")
        self.assertEqual(resp3.content, expected_msg)

        # 4. Embed Model (e.g. all-minilm-l6-v2)
        embed_client = Client("all-minilm-l6-v2")
        resp4 = embed_client.embed("Hello")
        self.assertEqual(resp4.raw.get("error"), expected_msg)


if __name__ == "__main__":
    unittest.main()
