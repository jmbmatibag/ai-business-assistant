"""Add ML analytical ingestion tables

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-28

Creates the following tables to support the continuous-improvement learning
pipeline (Epic 4 — Machine Learning Analytical Framework):

  ml_forecast_records       — predicted vs actual demand per SKU/store/date
  ml_consumption_curves     — rolling velocity averages (raw + EWM smoothed)
  ml_seasonal_patterns      — day-of-week and monthly demand multipliers
  ml_promotional_events     — tracked promotions with demand uplift factors
  ml_manual_overrides       — user-supplied velocity corrections
  ml_delivery_executions    — audit log of confirmed delivery runs
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # ml_forecast_records
    # ------------------------------------------------------------------
    op.create_table(
        "ml_forecast_records",
        sa.Column("id",               sa.Integer(),    primary_key=True),
        sa.Column("store_id",         sa.Integer(),    sa.ForeignKey("stores.id"), nullable=False),
        sa.Column("sku",              sa.String(64),   nullable=False),
        sa.Column("item_name",        sa.String(256),  nullable=True),
        sa.Column("forecast_date",    sa.Date(),       nullable=False),
        sa.Column("target_days",      sa.Integer(),    nullable=False, server_default="7"),
        sa.Column("predicted_qty",    sa.Float(),      nullable=False),
        sa.Column("actual_qty",       sa.Float(),      nullable=True),
        sa.Column("deviation_delta",  sa.Float(),      nullable=True),
        sa.Column("ape_pct",          sa.Float(),      nullable=True),
        sa.Column("safety_stock_pct", sa.Integer(),    nullable=False, server_default="10"),
        sa.Column("model_version",    sa.String(32),   nullable=False, server_default="mock-v1"),
    )
    op.create_index("ix_ml_forecast_store_id",   "ml_forecast_records", ["store_id"])
    op.create_index("ix_ml_forecast_sku",        "ml_forecast_records", ["sku"])
    op.create_index("ix_ml_forecast_date",       "ml_forecast_records", ["forecast_date"])
    op.create_unique_constraint(
        "uq_forecast_store_sku_date",
        "ml_forecast_records",
        ["store_id", "sku", "forecast_date"],
    )

    # ------------------------------------------------------------------
    # ml_consumption_curves
    # ------------------------------------------------------------------
    op.create_table(
        "ml_consumption_curves",
        sa.Column("id",                 sa.Integer(),  primary_key=True),
        sa.Column("store_id",           sa.Integer(),  sa.ForeignKey("stores.id"), nullable=False),
        sa.Column("sku",                sa.String(64), nullable=False),
        sa.Column("item_name",          sa.String(256), nullable=True),
        sa.Column("raw_avg_daily_qty",  sa.Float(),    nullable=False, server_default="0"),
        sa.Column("smoothed_velocity",  sa.Float(),    nullable=True),
        sa.Column("window_days",        sa.Integer(),  nullable=False, server_default="30"),
        sa.Column("last_updated",       sa.Date(),     nullable=True),
        sa.Column("observation_count",  sa.Integer(),  nullable=False, server_default="0"),
    )
    op.create_index("ix_ml_curves_store_id", "ml_consumption_curves", ["store_id"])
    op.create_index("ix_ml_curves_sku",      "ml_consumption_curves", ["sku"])
    op.create_unique_constraint(
        "uq_curve_store_sku",
        "ml_consumption_curves",
        ["store_id", "sku"],
    )

    # ------------------------------------------------------------------
    # ml_seasonal_patterns
    # ------------------------------------------------------------------
    op.create_table(
        "ml_seasonal_patterns",
        sa.Column("id",                 sa.Integer(),  primary_key=True),
        sa.Column("store_id",           sa.Integer(),  sa.ForeignKey("stores.id"), nullable=False),
        sa.Column("sku",                sa.String(64), nullable=False),
        sa.Column("pattern_type",       sa.String(32), nullable=False),
        sa.Column("pattern_key",        sa.String(8),  nullable=False),
        sa.Column("multiplier",         sa.Float(),    nullable=False, server_default="1.0"),
        sa.Column("observation_count",  sa.Integer(),  nullable=False, server_default="0"),
        sa.Column("last_updated",       sa.Date(),     nullable=True),
    )
    op.create_index("ix_ml_seasonal_store_id", "ml_seasonal_patterns", ["store_id"])
    op.create_index("ix_ml_seasonal_sku",      "ml_seasonal_patterns", ["sku"])
    op.create_unique_constraint(
        "uq_seasonal_store_sku_type_key",
        "ml_seasonal_patterns",
        ["store_id", "sku", "pattern_type", "pattern_key"],
    )

    # ------------------------------------------------------------------
    # ml_promotional_events
    # ------------------------------------------------------------------
    op.create_table(
        "ml_promotional_events",
        sa.Column("id",                       sa.Integer(),   primary_key=True),
        sa.Column("store_id",                 sa.Integer(),   sa.ForeignKey("stores.id"), nullable=True),
        sa.Column("sku",                      sa.String(64),  nullable=True),
        sa.Column("name",                     sa.String(128), nullable=False),
        sa.Column("description",              sa.Text(),      nullable=True),
        sa.Column("start_date",               sa.Date(),      nullable=False),
        sa.Column("end_date",                 sa.Date(),      nullable=False),
        sa.Column("demand_uplift_multiplier", sa.Float(),     nullable=False, server_default="1.0"),
        sa.Column("created_by",               sa.String(64),  nullable=False, server_default="system"),
    )
    op.create_index("ix_ml_promo_store_id",    "ml_promotional_events", ["store_id"])
    op.create_index("ix_ml_promo_sku",         "ml_promotional_events", ["sku"])
    op.create_index("ix_ml_promo_start_date",  "ml_promotional_events", ["start_date"])

    # ------------------------------------------------------------------
    # ml_manual_overrides
    # ------------------------------------------------------------------
    op.create_table(
        "ml_manual_overrides",
        sa.Column("id",                  sa.Integer(),  primary_key=True),
        sa.Column("store_id",            sa.Integer(),  sa.ForeignKey("stores.id"), nullable=False),
        sa.Column("sku",                 sa.String(64), nullable=False),
        sa.Column("override_daily_qty",  sa.Float(),    nullable=False),
        sa.Column("reason",              sa.Text(),     nullable=True),
        sa.Column("effective_from",      sa.Date(),     nullable=False),
        sa.Column("effective_until",     sa.Date(),     nullable=True),
        sa.Column("weight_pct",          sa.Integer(),  nullable=False, server_default="80"),
        sa.Column("created_by",          sa.String(64), nullable=False, server_default="system"),
    )
    op.create_index("ix_ml_override_store_id",     "ml_manual_overrides", ["store_id"])
    op.create_index("ix_ml_override_sku",          "ml_manual_overrides", ["sku"])
    op.create_index("ix_ml_override_effective",    "ml_manual_overrides", ["effective_from"])

    # ------------------------------------------------------------------
    # ml_delivery_executions
    # ------------------------------------------------------------------
    op.create_table(
        "ml_delivery_executions",
        sa.Column("id",                 sa.Integer(),  primary_key=True),
        sa.Column("store_id",           sa.Integer(),  sa.ForeignKey("stores.id"), nullable=False),
        sa.Column("executed_at",        sa.Date(),     nullable=False),
        sa.Column("initiated_by",       sa.String(16), nullable=False, server_default="manual"),
        sa.Column("plan_snapshot",      sa.Text(),     nullable=True),
        sa.Column("total_skus",         sa.Integer(),  nullable=False, server_default="0"),
        sa.Column("total_units",        sa.Integer(),  nullable=False, server_default="0"),
        sa.Column("source_forecast_id", sa.Integer(),
                  sa.ForeignKey("ml_forecast_records.id"), nullable=True),
    )
    op.create_index("ix_ml_delivery_store_id",  "ml_delivery_executions", ["store_id"])
    op.create_index("ix_ml_delivery_date",      "ml_delivery_executions", ["executed_at"])


def downgrade() -> None:
    op.drop_table("ml_delivery_executions")
    op.drop_table("ml_manual_overrides")
    op.drop_table("ml_promotional_events")
    op.drop_table("ml_seasonal_patterns")
    op.drop_table("ml_consumption_curves")
    op.drop_table("ml_forecast_records")
