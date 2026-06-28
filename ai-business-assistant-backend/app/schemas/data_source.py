"""Schemas for managing external data-source connections.

The plaintext password is accepted on create/update but never returned.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

ALLOWED_DIALECTS = ["postgresql", "mysql"]


class DataSourceCreate(BaseModel):
    connection_name: str = Field(min_length=1, max_length=100)
    db_dialect: str = Field(default="postgresql", max_length=20)
    db_host: str = Field(min_length=1, max_length=255)
    db_port: int = Field(default=5432, ge=1, le=65535)
    db_username: str = Field(min_length=1, max_length=100)
    db_password: str = Field(min_length=1)
    db_name: str = Field(min_length=1, max_length=100)
    is_active: bool = True


class DataSourceUpdate(BaseModel):
    connection_name: str | None = Field(default=None, max_length=100)
    db_dialect: str | None = Field(default=None, max_length=20)
    db_host: str | None = Field(default=None, max_length=255)
    db_port: int | None = Field(default=None, ge=1, le=65535)
    db_username: str | None = Field(default=None, max_length=100)
    db_password: str | None = Field(default=None)
    db_name: str | None = Field(default=None, max_length=100)
    is_active: bool | None = None


class DataSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    connection_name: str
    db_dialect: str
    db_host: str
    db_port: int
    db_username: str
    db_name: str
    is_active: bool
    created_at: datetime


class ConnectionTestResult(BaseModel):
    ok: bool
    message: str


class ConnectionStatusOut(BaseModel):
    """Real-time health of the live POS database the app currently reads from."""

    # "connected" | "error" ("unavailable" is inferred client-side on fetch failure)
    status: str
    detail: str | None = None
    target: str
