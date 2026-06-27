"""Schemas for the chat endpoint."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    created_at: datetime


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    # Omit to start a new conversation; pass to continue an existing one.
    conversation_id: int | None = None


class ChatResponse(BaseModel):
    conversation_id: int
    reply: str
    tools_used: list[dict[str, Any]] = []
