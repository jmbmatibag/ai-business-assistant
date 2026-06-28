"""Machine-learning analytical ingestion models.

These tables form the continuous-improvement data path. Python forecasting
scripts read from the existing transactional tables (receipts, sales_items)
and write derived signals here. The ML layer then uses these signals to tighten
replenishment recommendations over time.

Ingestion sources wired in:
  - Historical Sales Data         → ForecastRecord.actual_qty from sales_items
  - Previous Forecast Deviations  → ForecastRecord.predicted_qty vs actual_qty
  - Actual Deliveries Executed    → DeliveryExecution
  - Real Consumption Curves       → ConsumptionCurve (rolling daily avg)
  - Seasonal Trends               → SeasonalPattern (day-of-week + monthly)
  - Weekly Purchasing Loops       → ConsumptionCurve.week_label aggregation
  - Promotional Trackers          → PromotionalEvent
  - User Manual Overrides         → ManualOverride
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import (
    Date,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ForecastRecord(Base):
    """One forecast vs. actual comparison per SKU per store per forecast period.

    The deviation delta (actual - predicted) is the primary learning signal.
    Forecasting scripts walk this table to compute rolling MAPE and adjust
    future velocity estimates.
    """

    __tablename__ = "ml_forecast_records"
    __table_args__ = (
        UniqueConstraint("store_id", "sku", "forecast_date", name="uq_forecast_store_sku_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    item_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    forecast_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    target_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)

    predicted_qty: Mapped[float] = mapped_column(Float, nullable=False)
    actual_qty: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Filled in once actual_qty is known: actual - predicted (negative = overforecast).
    deviation_delta: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Absolute percentage error: |delta| / actual * 100
    ape_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    safety_stock_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    model_version: Mapped[str] = mapped_column(String(32), nullable=False, default="mock-v1")

    def compute_deviation(self) -> None:
        """Populate deviation_delta and ape_pct once actual_qty is available."""
        if self.actual_qty is None:
            return
        self.deviation_delta = self.actual_qty - self.predicted_qty
        if self.actual_qty != 0:
            self.ape_pct = abs(self.deviation_delta / self.actual_qty) * 100
        else:
            self.ape_pct = 0.0


class ConsumptionCurve(Base):
    """Rolling daily consumption average per SKU per store.

    Updated incrementally each time a new day's sales are finalised.
    The ``smoothed_velocity`` column (exponentially weighted) is what the
    replenishment engine should prefer over the raw average when both exist.
    """

    __tablename__ = "ml_consumption_curves"
    __table_args__ = (
        UniqueConstraint("store_id", "sku", name="uq_curve_store_sku"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    item_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # Simple arithmetic mean over the trailing window.
    raw_avg_daily_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    # Exponentially weighted moving average (alpha configurable at pipeline level).
    smoothed_velocity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Window used to compute the raw average (in days).
    window_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    # Date of the last sales record that contributed to this curve.
    last_updated: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    # Total observations (records) incorporated.
    observation_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SeasonalPattern(Base):
    """Demand multipliers for known seasonal signals.

    Indexed by (store_id, sku, pattern_type, pattern_key).
    The multiplier is applied on top of the base ConsumptionCurve velocity to
    produce a seasonally adjusted forecast.

    Examples:
      pattern_type="day_of_week",  pattern_key="0"  → Monday multiplier
      pattern_type="month",        pattern_key="12" → December multiplier
      pattern_type="week_of_year", pattern_key="1"  → First week of year
    """

    __tablename__ = "ml_seasonal_patterns"
    __table_args__ = (
        UniqueConstraint(
            "store_id", "sku", "pattern_type", "pattern_key",
            name="uq_seasonal_store_sku_type_key"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # "day_of_week" | "month" | "week_of_year"
    pattern_type: Mapped[str] = mapped_column(String(32), nullable=False)
    # String-encoded key within that pattern (e.g. "0" for Monday, "12" for December)
    pattern_key: Mapped[str] = mapped_column(String(8), nullable=False)

    # Ratio: 1.0 = baseline, 1.3 = 30% uplift, 0.7 = 30% suppression.
    multiplier: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    # How many observations backed this estimate.
    observation_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_updated: Mapped[Optional[date]] = mapped_column(Date, nullable=True)


class PromotionalEvent(Base):
    """Tracked promotions and expected demand uplift for affected SKUs.

    The replenishment engine queries this table to inflate forecasts during
    active promotional windows, preventing stock shortfalls during campaigns.
    """

    __tablename__ = "ml_promotional_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Null store_id = chain-wide promotion.
    store_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("stores.id"), nullable=True, index=True
    )
    sku: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    # Multiplicative demand uplift during the promo window (e.g. 1.4 = +40%).
    demand_uplift_multiplier: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="system")


class ManualOverride(Base):
    """User-supplied adjustments that the ML engine must incorporate.

    When an operator sets a manual override, the next forecast cycle blends
    the override into the velocity estimate instead of ignoring it. Override
    weight decays over ``decay_days`` so the system self-corrects as new
    sales data accumulates.
    """

    __tablename__ = "ml_manual_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # The operator's target daily velocity (units/day).
    override_daily_qty: Mapped[float] = mapped_column(Float, nullable=False)
    # Reason code for audit trail.
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # After this date the override expires and the ML estimate takes over.
    effective_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # 0–100: how heavily this override should be weighted vs. the ML estimate.
    # 100 = fully manual, 0 = fully ML (effectively a no-op override).
    weight_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=80)

    created_by: Mapped[str] = mapped_column(String(64), nullable=False, default="system")


class DeliveryExecution(Base):
    """Audit log of every confirmed delivery run.

    Feeds back into the ML pipeline so the system can compare planned vs.
    actual delivery quantities and refine future recommendations.
    """

    __tablename__ = "ml_delivery_executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(Integer, ForeignKey("stores.id"), nullable=False, index=True)

    executed_at: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # "ai" = AI-generated plan confirmed by user | "manual" = user-authored plan
    initiated_by: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")

    # JSON-encoded snapshot of the delivery plan items for audit purposes.
    plan_snapshot: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    total_skus: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Forecast record that triggered this delivery (nullable for manual plans).
    source_forecast_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("ml_forecast_records.id"), nullable=True
    )
