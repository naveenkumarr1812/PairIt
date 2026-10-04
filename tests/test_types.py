import unittest
from pairit.types import ChatChunk, ChatResponse, EmbeddingResponse


class TestTypes(unittest.TestCase):
    def test_chat_response_defaults(self):
        resp = ChatResponse(
            id="resp_123",
            object="chat.completion",
            created=1000000,
            model="qwen3-0.6b",
            content="Hello world",
            provider="stateless",
        )
        self.assertEqual(resp.content, "Hello world")
        self.assertEqual(resp.model, "qwen3-0.6b")
        self.assertEqual(resp.provider, "stateless")
        self.assertIsNone(resp.backend)
        self.assertEqual(resp.raw, {})

    def test_embedding_response(self):
        resp = EmbeddingResponse(
            model="all-minilm-l6-v2",
            vectors=[[0.1, 0.2, 0.3]],
            dimensions=3,
            raw={"raw_key": "val", "backend": "webgpu"},
        )
        self.assertEqual(resp.model, "all-minilm-l6-v2")
        self.assertEqual(resp.dimensions, 3)
        self.assertEqual(resp.backend, "webgpu")
        self.assertEqual(resp.vectors, [[0.1, 0.2, 0.3]])

    def test_chat_chunk(self):
        chunk = ChatChunk(
            id="chunk_1",
            object="chat.completion.chunk",
            created=1000000,
            model="chatgpt",
            content="Hi",
            provider="chatgpt",
            raw={"backend": "cloud"},
        )
        self.assertEqual(chunk.content, "Hi")
        self.assertEqual(chunk.delta, "Hi")
        self.assertEqual(chunk.backend, "cloud")


if __name__ == "__main__":
    unittest.main()
