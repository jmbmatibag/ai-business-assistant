"""Dynamic AI configuration parameters.

Stored as a single-row (singleton) table so the chat layer can read the
operational parameters that shape Claude's system prompt at request time.
"""

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Default model: the latest, most capable Claude model.
DEFAULT_MODEL = "claude-opus-4-8"

DEFAULT_SYSTEM_PROMPT = (
    "You are an AI business assistant for a multi-branch food retail operation. "
    "You analyze point-of-sale data to summarize sales, surface inventory risks, "
    "and flag operational anomalies such as spikes in cancelled transactions. "
    "Be concise, data-driven, and call out the numbers behind every claim."
)


class AISettings(Base):
    __tablename__ = "ai_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    current_model: Mapped[str] = mapped_column(
        String(64), nullable=False, default=DEFAULT_MODEL, server_default=DEFAULT_MODEL
    )
    base_system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Percentage of forecasted demand kept as buffer stock (0-100).
    default_safety_stock: Mapped[int] = mapped_column(
        Integer, nullable=False, default=20, server_default="20"
    )
    # Cancelled-transaction count (per store/day) above which an anomaly is flagged.
    anomaly_threshold: Mapped[int] = mapped_column(
        Integer, nullable=False, default=3, server_default="3"
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<AISettings id={self.id} model={self.current_model!r}>"
