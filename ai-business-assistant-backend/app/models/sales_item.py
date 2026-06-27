"""Line items belonging to a receipt."""

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.receipt import Receipt


class SalesItem(Base):
    __tablename__ = "sales_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    receipt_id: Mapped[int] = mapped_column(
        ForeignKey("receipts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    sku: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    gross_sales: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    net_sales: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    gross_profit: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)

    receipt: Mapped["Receipt"] = relationship(back_populates="items")

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<SalesItem id={self.id} item_name={self.item_name!r} qty={self.quantity}>"
