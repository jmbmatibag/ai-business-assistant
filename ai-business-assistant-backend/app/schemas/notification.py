"""Schemas for the notifications API."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int | None
    type: str
    message: str
    suggested_prompt: str | None
    status: str
    created_at: datetime


class NotificationList(BaseModel):
    unread_count: int
    notifications: list[NotificationOut]


class ScanResult(BaseModel):
    created: int
    notifications: list[NotificationOut]
