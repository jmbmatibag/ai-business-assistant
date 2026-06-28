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
    # Whether an operator-supplied Anthropic API key is stored. The key itself
    # is write-only and never returned.
    anthropic_api_key_set: bool = False


class AISettingsUpdate(BaseModel):
    """All fields optional — callers patch only what changed."""

    current_model: str | None = Field(default=None, max_length=64)
    base_system_prompt: str | None = None
    default_safety_stock: int | None = Field(default=None, ge=0, le=100)
    anomaly_threshold: int | None = Field(default=None, ge=0)
    # Send a new key to set/replace it, or an empty string to clear it. Omit to
    # leave the stored key unchanged.
    anthropic_api_key: str | None = Field(default=None, max_length=256)


class AnthropicTestRequest(BaseModel):
    """Test-connection payload. Send a key to validate the value the operator
    just typed; omit it to validate the key already saved on the server."""

    anthropic_api_key: str | None = Field(default=None, max_length=256)


class AnthropicTestResult(BaseModel):
    """Outcome of a test-and-validate ping against the Anthropic API."""

    success: bool
    # The model the ping was sent against (echoed for UI context).
    model: str | None = None
    # Short, human-readable failure reason when success is False (e.g.
    # "Unauthorized", "Quota exceeded"). None on success.
    error: str | None = None
