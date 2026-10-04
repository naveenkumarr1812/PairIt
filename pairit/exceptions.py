from __future__ import annotations


class PairitError(Exception):
    """Base exception for pairit."""


class BridgeNotRunningError(PairitError):
    """Raised when the local pairit bridge cannot be started or reached."""


class ExtensionNotConnectedError(PairitError):
    """Raised when the pairit Chrome extension is not connected."""


class ProviderNotOpenError(PairitError):
    """Raised when the requested browser AI provider is not open."""


class ProviderError(PairitError):
    """Raised when the browser provider reports an error."""


class ChatTimeoutError(PairitError):
    """Raised when a browser response does not arrive in time."""


# ====================================================================
# Stateless Model Exceptions
# ====================================================================


class ModelError(PairitError):
    """Base exception for stateless model errors."""


class UnknownModelError(ModelError):
    """Raised when an unknown model name is requested."""


class ModelNotDownloadedError(ModelError):
    """Raised when inference is requested for a model that has not been downloaded."""


class ModelDownloadError(ModelError):
    """Raised when downloading a model fails."""


class ModelVerificationError(ModelError):
    """Raised when model artifact integrity verification fails."""


class ModelLoadError(ModelError):
    """Raised when loading a model into memory fails."""


class ModelRuntimeError(ModelError):
    """Raised when a runtime error occurs during model execution."""


class ModelStorageError(ModelError):
    """Raised when storage operations or quota checks fail."""


class ModelOutOfMemoryError(ModelError):
    """Raised when model execution fails due to insufficient memory."""


class UnsupportedOperationError(ModelError):
    """Raised when an operation is not supported by the model's capabilities."""


class ModelBusyError(ModelError):
    """Raised when the model runtime worker is busy."""


class InvalidImageError(ModelError):
    """Raised when an invalid image is provided to vision()."""
