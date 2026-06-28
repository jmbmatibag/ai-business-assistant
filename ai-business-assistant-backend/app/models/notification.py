"""System notifications surfaced to operators (e.g. stock-out risk, anomalies).

Each notification can carry a ``suggested_prompt`` — a natural-language request
the UI pre-fills into the chat input when the operator clicks the notification's
action button, deep-linking them into the assistant with the work already framed.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.store import Store

# Notification type constants.
TYPE_STOCKOUT_RISK = "STOCKOUT_RISK"
TYPE_ANOMALY = "ANOMALY"

# Status constants.
STATUS_UNREAD = "Unread"
STATUS_READ = "Read"


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int | None] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # e.g. 'STOCKOUT_RISK', 'ANOMALY'
    type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    # Pre-built natural-language prompt for the "Suggest a Plan" deep link.
    suggested_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 'Unread' or 'Read'
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=STATUS_UNREAD, server_default=STATUS_UNREAD
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    store: Mapped["Store | None"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Notification id={self.id} type={self.type!r} status={self.status!r}>"
