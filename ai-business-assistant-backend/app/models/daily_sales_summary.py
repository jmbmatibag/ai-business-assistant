"""End-of-Day aggregated sales statistics.

These rows are computed once per day by the EOD worker (``scripts/eod_summary``)
from the raw ``receipts`` / ``sales_items`` tables. The multi-period analytics
endpoints pivot off this summary table so long-range queries (quarterly, annual)
stay sub-second and never touch the live transaction tables during peak hours.
"""

from datetime import date as date_type
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.store import Store


class DailySalesSummary(Base):
    __tablename__ = "daily_sales_summaries"
    __table_args__ = (
        UniqueConstraint(
            "summary_date", "store_id", "category", name="uq_daily_summary_dimensions"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    summary_date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Aggregation is per-category so the UI can break sales down by category.
    category: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    total_quantity_sold: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    total_net_sales: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=0
    )
    total_cancelled_receipts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    total_gross_profit: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=0
    )

    store: Mapped["Store"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<DailySalesSummary {self.summary_date} store_id={self.store_id} "
            f"category={self.category!r}>"
        )
