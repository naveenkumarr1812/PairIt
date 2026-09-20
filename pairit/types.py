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


@dataclass(slots=True)
class ChatResponse:
    id: str
    object: str
    created: int
    model: str
    content: str
    provider: str
    raw: dict[str, Any]

    @property
    def message(self) -> dict[str, str]:
        return {
            "role": "assistant",
            "content": self.content,
        }
