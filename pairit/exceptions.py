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
