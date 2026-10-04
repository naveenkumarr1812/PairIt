import unittest
from pairit.exceptions import (
    PairitError,
    ModelError,
    UnknownModelError,
    ModelNotDownloadedError,
    ModelDownloadError,
    ModelVerificationError,
    ModelLoadError,
    ModelRuntimeError,
    ModelStorageError,
    ModelOutOfMemoryError,
    UnsupportedOperationError,
    ModelBusyError,
    InvalidImageError,
)


class TestExceptions(unittest.TestCase):
    def test_hierarchy(self):
        # All model exceptions inherit from ModelError and PairitError
        model_exceptions = [
            UnknownModelError,
            ModelNotDownloadedError,
            ModelDownloadError,
            ModelVerificationError,
            ModelLoadError,
            ModelRuntimeError,
            ModelStorageError,
            ModelOutOfMemoryError,
            UnsupportedOperationError,
            ModelBusyError,
            InvalidImageError,
        ]

        for exc_cls in model_exceptions:
            with self.subTest(exception=exc_cls.__name__):
                instance = exc_cls("test error message")
                self.assertIsInstance(instance, ModelError)
                self.assertIsInstance(instance, PairitError)
                self.assertIsInstance(instance, Exception)
                self.assertEqual(str(instance), "test error message")


if __name__ == "__main__":
    unittest.main()
