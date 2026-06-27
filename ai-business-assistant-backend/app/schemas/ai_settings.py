"""Schemas for reading and updating AI configuration."""

from pydantic import BaseModel, ConfigDict, Field

# Current, selectable Claude models (latest lineup). The default is the most
# capable model; older/cheaper tiers are offered for cost-sensitive workloads.
ALLOWED_MODELS = [
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
]


class AISettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    current_model: str
    base_system_prompt: str
    default_safety_stock: int
    anomaly_threshold: int


class AISettingsUpdate(BaseModel):
    """All fields optional — callers patch only what changed."""

    current_model: str | None = Field(default=None, max_length=64)
    base_system_prompt: str | None = None
    default_safety_stock: int | None = Field(default=None, ge=0, le=100)
    anomaly_threshold: int | None = Field(default=None, ge=0)
