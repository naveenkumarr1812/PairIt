import json
import os
import unittest
from pathlib import Path
from pairit.models import STATELESS_MODELS


class TestRegistry(unittest.TestCase):
    def setUp(self):
        self.repo_root = Path(__file__).parent.parent
        self.registry_path = self.repo_root / "extension" / "stateless" / "registry" / "models.json"

    def test_registry_file_exists(self):
        self.assertTrue(self.registry_path.is_file(), f"models.json not found at {self.registry_path}")

    def test_registry_valid_json(self):
        with open(self.registry_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.assertIn("schemaVersion", data)
        self.assertIn("models", data)
        self.assertIsInstance(data["models"], list)
        self.assertEqual(len(data["models"]), len(STATELESS_MODELS))

    def test_models_spec_integrity(self):
        with open(self.registry_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        model_ids = set()
        for model in data["models"]:
            m_id = model["id"]
            model_ids.add(m_id)
            self.assertIn(m_id, STATELESS_MODELS)

            # Check required fields
            self.assertIn("displayName", model)
            self.assertIn("category", model)
            self.assertIn("capabilities", model)
            self.assertIn("source", model)
            self.assertIn("runtime", model)
            self.assertIn("artifacts", model)

            # Check artifacts have sha256 and url
            self.assertGreater(len(model["artifacts"]), 0)
            for art in model["artifacts"]:
                self.assertIn("path", art)
                self.assertIn("url", art)
                self.assertIn("sha256", art)
                self.assertIn("sizeBytes", art)
                # SHA256 must be 64 hex characters
                self.assertEqual(len(art["sha256"]), 64)
                int(art["sha256"], 16)  # must be valid hex

        self.assertEqual(model_ids, set(STATELESS_MODELS.keys()))


if __name__ == "__main__":
    unittest.main()
