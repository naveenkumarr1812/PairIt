from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ChatChunk:
    """One incremental piece of a streamed AI response."""

    id: str
    object: str
    created: int
    model: str
    content: str
    provider: str
    done: bool = False
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def delta(self) -> str:
        return self.content

    @property
    def backend(self) -> str | None:
        return self.raw.get("backend") if isinstance(self.raw, dict) else None


@dataclass(slots=True)
class ChatResponse:
    id: str
    object: str
    created: int
    model: str
    content: str
    provider: str
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def message(self) -> dict[str, str]:
        return {
            "role": "assistant",
            "content": self.content,
        }

    @property
    def backend(self) -> str | None:
        return self.raw.get("backend") if isinstance(self.raw, dict) else None


@dataclass(slots=True)
class EmbeddingResponse:
    """Response containing embedding vectors from an embedding model."""

    model: str
    vectors: list[list[float]]
    dimensions: int
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def backend(self) -> str | None:
        return self.raw.get("backend") if isinstance(self.raw, dict) else None
