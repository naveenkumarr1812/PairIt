import unittest
from pairit.models import (
    STATEFUL_MODELS,
    STATELESS_MODELS,
    normalize_model_name,
    is_stateful_model,
    is_stateless_model,
    get_model_category,
    get_model_capabilities,
    validate_model_operation,
    list_supported_models,
)
from pairit.exceptions import UnknownModelError, UnsupportedOperationError


class TestModels(unittest.TestCase):
    def test_normalize_model_name(self):
        self.assertEqual(normalize_model_name("  ChatGPT  "), "chatgpt")
        self.assertEqual(normalize_model_name("QWEN3-0.6B"), "qwen3-0.6b")
        with self.assertRaises(ValueError):
            normalize_model_name("")
        with self.assertRaises(ValueError):
            normalize_model_name("   ")

    def test_stateful_recognition(self):
        for name in ["chatgpt", "claude", "gemini"]:
            self.assertTrue(is_stateful_model(name))
            self.assertFalse(is_stateless_model(name))
            self.assertEqual(get_model_category(name), "stateful")
            self.assertEqual(get_model_capabilities(name), {"chat"})

    def test_stateless_recognition(self):
        for name, expected_cat, expected_caps in [
            ("qwen3-0.6b", "llm", {"chat"}),
            ("smollm2-360m", "llm", {"chat"}),
            ("qwen2.5-coder-0.5b", "llm", {"chat"}),
            ("smolvlm-500m", "vlm", {"vision"}),
            ("moondream2", "vlm", {"vision"}),
            ("vit-gpt2-image-captioning", "vlm", {"vision"}),
            ("all-minilm-l6-v2", "embedding", {"embed"}),
            ("bge-small-en-v1.5", "embedding", {"embed"}),
            ("smollm2-135m", "llm", {"chat"}),
            ("gte-small", "embedding", {"embed"}),
            ("multilingual-e5-small", "embedding", {"embed"}),
            ("trocr-small-printed", "vlm", {"vision"}),
        ]:
            self.assertTrue(is_stateless_model(name))
            self.assertFalse(is_stateful_model(name))
            self.assertEqual(get_model_category(name), expected_cat)
            self.assertEqual(get_model_capabilities(name), expected_caps)

        # Test aliases and display names
        self.assertEqual(normalize_model_name("SmolLM2 135M"), "smollm2-135m")
        self.assertEqual(normalize_model_name("GTE Small"), "gte-small")
        self.assertEqual(normalize_model_name("Multilingual E5 Small"), "multilingual-e5-small")
        self.assertEqual(normalize_model_name("TrOCR Small Printed"), "trocr-small-printed")
        self.assertEqual(normalize_model_name("qwen2.5-0.5b"), "qwen3-0.6b")

    def test_validate_model_operation(self):
        # Valid operations
        validate_model_operation("chatgpt", "chat")
        validate_model_operation("qwen3-0.6b", "chat")
        validate_model_operation("smollm2-360m", "chat")
        validate_model_operation("qwen2.5-coder-0.5b", "chat")
        validate_model_operation("smolvlm-500m", "vision")
        validate_model_operation("moondream2", "vision")
        validate_model_operation("vit-gpt2-image-captioning", "vision")
        validate_model_operation("all-minilm-l6-v2", "embed")
        validate_model_operation("bge-small-en-v1.5", "embed")
        validate_model_operation("smollm2-135m", "chat")
        validate_model_operation("gte-small", "embed")
        validate_model_operation("multilingual-e5-small", "embed")
        validate_model_operation("trocr-small-printed", "vision")

        # Invalid operations
        with self.assertRaises(UnsupportedOperationError):
            validate_model_operation("qwen3-0.6b", "embed")
        with self.assertRaises(UnsupportedOperationError):
            validate_model_operation("all-minilm-l6-v2", "chat")
        with self.assertRaises(UnsupportedOperationError):
            validate_model_operation("smolvlm-500m", "chat")
        with self.assertRaises(UnsupportedOperationError):
            validate_model_operation("moondream2", "embed")

        # Unknown model
        with self.assertRaises(UnknownModelError):
            validate_model_operation("nonexistent-model", "chat")

    def test_list_supported_models(self):
        models = list_supported_models()
        self.assertIn("chatgpt", models)
        self.assertIn("claude", models)
        self.assertIn("gemini", models)
        self.assertIn("qwen3-0.6b", models)
        self.assertIn("smollm2-360m", models)
        self.assertIn("qwen2.5-coder-0.5b", models)
        self.assertIn("smolvlm-500m", models)
        self.assertIn("moondream2", models)
        self.assertIn("vit-gpt2-image-captioning", models)
        self.assertIn("all-minilm-l6-v2", models)
        self.assertIn("bge-small-en-v1.5", models)
        self.assertIn("smollm2-135m", models)
        self.assertIn("gte-small", models)
        self.assertIn("multilingual-e5-small", models)
        self.assertIn("trocr-small-printed", models)


if __name__ == "__main__":
    unittest.main()
