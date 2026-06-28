"""AI configuration routes (read / update the singleton settings row)."""

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.crypto import encrypt_secret
from app.db.session import get_db
from app.models.ai_settings import DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, AISettings
from app.models.user import User
from app.schemas.ai_settings import (
    ALLOWED_MODELS,
    AISettingsOut,
    AISettingsUpdate,
    AnthropicTestRequest,
    AnthropicTestResult,
)
from app.services.claude_agent import resolve_api_key

router = APIRouter(prefix="/api/ai-settings", tags=["ai-settings"])

# Display labels for the selectable models (kept beside the allowlist).
MODEL_OPTIONS = [
    {"id": "claude-opus-4-8", "label": "Claude Opus 4.8 (most capable)"},
    {"id": "claude-opus-4-7", "label": "Claude Opus 4.7"},
    {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6 (balanced)"},
    {"id": "claude-haiku-4-5", "label": "Claude Haiku 4.5 (fastest)"},
]


@router.get("/models")
def list_models(_: User = Depends(get_current_user)) -> list[dict[str, str]]:
    return MODEL_OPTIONS


def get_or_create_settings(db: Session) -> AISettings:
    """Return the singleton settings row, creating it with defaults if absent."""
    settings = db.execute(select(AISettings).limit(1)).scalar_one_or_none()
    if settings is None:
        settings = AISettings(
            current_model=DEFAULT_MODEL,
            base_system_prompt=DEFAULT_SYSTEM_PROMPT,
            default_safety_stock=20,
            anomaly_threshold=3,
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get("", response_model=AISettingsOut)
def read_settings(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> AISettings:
    return get_or_create_settings(db)


@router.put("", response_model=AISettingsOut)
def update_settings(
    payload: AISettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> AISettings:
    settings = get_or_create_settings(db)

    data = payload.model_dump(exclude_unset=True)

    if "current_model" in data and data["current_model"] not in ALLOWED_MODELS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported model. Choose one of: {', '.join(ALLOWED_MODELS)}",
        )

    # The API key is write-only: a blank value clears it, any other value is
    # Fernet-encrypted before storage. Omitting the field leaves it untouched.
    if "anthropic_api_key" in data:
        raw = (data.pop("anthropic_api_key") or "").strip()
        settings.anthropic_api_key_encrypted = encrypt_secret(raw) if raw else None

    for field, value in data.items():
        setattr(settings, field, value)

    db.commit()
    db.refresh(settings)
    return settings


@router.post("/test-anthropic", response_model=AnthropicTestResult)
def test_anthropic_key(
    payload: AnthropicTestRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> AnthropicTestResult:
    """Validate an Anthropic API key with a minimal, low-token ping.

    If the payload carries a key, that value is tested (lets the operator
    verify a key they just typed before saving). Otherwise the key already
    configured on the server — stored row, then ANTHROPIC_API_KEY env — is
    tested via the same resolution the chat engine uses.
    """
    settings = get_or_create_settings(db)

    api_key = (payload.anthropic_api_key or "").strip() or resolve_api_key(settings)
    if not api_key:
        return AnthropicTestResult(
            success=False,
            error="No API key to test — type one above or set ANTHROPIC_API_KEY.",
        )

    # Ping the model the chat actually uses, so the test also confirms the key
    # has access to it. max_tokens=1 keeps the call minimal.
    model = settings.current_model
    client = anthropic.Anthropic(api_key=api_key)
    try:
        client.messages.create(
            model=model,
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
    except anthropic.AuthenticationError:
        return AnthropicTestResult(success=False, model=model, error="Unauthorized — invalid API key")
    except anthropic.PermissionDeniedError:
        return AnthropicTestResult(
            success=False, model=model, error="Permission denied — key lacks access to this model"
        )
    except anthropic.RateLimitError:
        return AnthropicTestResult(
            success=False, model=model, error="Quota exceeded or rate limited"
        )
    except anthropic.NotFoundError:
        return AnthropicTestResult(
            success=False, model=model, error=f"Model not found: {model}"
        )
    except anthropic.APIConnectionError:
        return AnthropicTestResult(
            success=False, model=model, error="Network error reaching the Anthropic API"
        )
    except anthropic.APIStatusError as exc:
        return AnthropicTestResult(
            success=False, model=model, error=f"API error ({exc.status_code})"
        )

    return AnthropicTestResult(success=True, model=model)
