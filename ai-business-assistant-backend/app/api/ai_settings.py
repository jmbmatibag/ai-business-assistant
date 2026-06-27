"""AI configuration routes (read / update the singleton settings row)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.ai_settings import DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, AISettings
from app.models.user import User
from app.schemas.ai_settings import ALLOWED_MODELS, AISettingsOut, AISettingsUpdate

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

    for field, value in data.items():
        setattr(settings, field, value)

    db.commit()
    db.refresh(settings)
    return settings
