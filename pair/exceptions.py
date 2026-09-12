class PairError(Exception):
    """Base exception for PAIR."""


class BridgeNotRunningError(PairError):
    """Raised when the local PAIR bridge cannot be started or reached."""


class ExtensionNotConnectedError(PairError):
    """Raised when the PAIR Chrome extension is not connected."""


class ProviderNotOpenError(PairError):
    """Raised when the requested browser AI provider is not open."""


class ProviderError(PairError):
    """Raised when the browser provider reports an error."""


class ChatTimeoutError(PairError):
    """Raised when a browser response does not arrive in time."""
