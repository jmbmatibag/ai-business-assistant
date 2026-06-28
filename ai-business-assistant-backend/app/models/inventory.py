"""Current on-hand inventory levels per store / SKU.

This represents the *live* stock position read from the POS database. The
real-time scanner compares these quantities against recent sales velocity to
surface stock-out risk; the replenishment engine uses them to size deliveries.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.store import Store


class InventoryLevel(Base):
    __tablename__ = "inventory_levels"
    __table_args__ = (
        UniqueConstraint("store_id", "sku", name="uq_inventory_store_sku"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sku: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    item_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    store: Mapped["Store"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<InventoryLevel store_id={self.store_id} sku={self.sku!r} "
            f"qty={self.quantity}>"
        )
