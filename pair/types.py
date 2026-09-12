from __future__ import annotations

from dataclasses import dataclass
from typing import Any


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