"""Receipts / transactions from the POS.

The ``status`` column strictly preserves the POS values 'Closed' and
'Cancelled' so the AI can track cancellations as an operational-anomaly metric.
"""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.sales_item import SalesItem
    from app.models.store import Store


class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    receipt_number: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )
    receipt_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    # Preserve POS status verbatim: 'Closed' or 'Cancelled'.
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    store: Mapped["Store"] = relationship(back_populates="receipts")
    items: Mapped[list["SalesItem"]] = relationship(
        back_populates="receipt", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<Receipt id={self.id} receipt_number={self.receipt_number!r} "
            f"status={self.status!r}>"
        )
