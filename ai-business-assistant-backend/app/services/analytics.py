"""Multi-period analytics computed from the EOD summary table.

All long-range queries pivot off ``daily_sales_summaries`` (never the raw
transaction tables), so monthly → annual rollups stay fast. Bucketing is done in
Python from the daily rows, which keeps the query simple and dialect-agnostic.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.models.daily_sales_summary import DailySalesSummary
from app.services.sql_compat import _set_read_only

# period -> (bucket function, how many trailing buckets to return)
_PERIODS = {"monthly", "quarterly", "semi-annual", "annual"}

# Trailing bucket counts per granularity.
_BUCKET_LIMITS = {
    "monthly": 12,
    "quarterly": 8,
    "semi-annual": 6,
    "annual": 5,
}


def _bucket_key(d: date, period: str) -> tuple[tuple[int, int], str]:
    """Return ((sort_year, sort_index), human_label) for a date in a period."""
    if period == "monthly":
        return (d.year, d.month), f"{d.strftime('%b')} {d.year}"
    if period == "quarterly":
        q = (d.month - 1) // 3 + 1
        return (d.year, q), f"Q{q} {d.year}"
    if period == "semi-annual":
        h = 1 if d.month <= 6 else 2
        return (d.year, h), f"{'H1' if h == 1 else 'H2'} {d.year}"
    # annual
    return (d.year, 0), str(d.year)


def trends(db: Session, period: str, store_id: int | None = None) -> dict[str, Any]:
    """Aggregate the EOD summaries into the requested time granularity."""
    if period not in _PERIODS:
        raise ValueError(f"Unsupported period: {period}")

    stmt = select(DailySalesSummary)
    if store_id is not None:
        stmt = stmt.where(DailySalesSummary.store_id == store_id)

    buckets: dict[tuple[int, int], dict[str, Any]] = {}
    for row in db.execute(stmt).scalars():
        key, label = _bucket_key(row.summary_date, period)
        b = buckets.setdefault(
            key,
            {
                "label": label,
                "net_sales": Decimal("0"),
                "gross_profit": Decimal("0"),
                "quantity": 0,
                "cancelled_receipts": 0,
            },
        )
        b["net_sales"] += row.total_net_sales or Decimal("0")
        b["gross_profit"] += row.total_gross_profit or Decimal("0")
        b["quantity"] += row.total_quantity_sold or 0
        b["cancelled_receipts"] += row.total_cancelled_receipts or 0

    ordered_keys = sorted(buckets.keys())
    limit = _BUCKET_LIMITS[period]
    ordered_keys = ordered_keys[-limit:]

    points = [
        {
            "label": buckets[k]["label"],
            "net_sales": float(buckets[k]["net_sales"]),
            "gross_profit": float(buckets[k]["gross_profit"]),
            "quantity": buckets[k]["quantity"],
            "cancelled_receipts": buckets[k]["cancelled_receipts"],
        }
        for k in ordered_keys
    ]
    return {"period": period, "points": points}


def dashboard_metrics(eng: Engine) -> dict[str, Any]:
    """Headline metrics for the dashboard cards, computed against ``eng``.

    Works against both the live POS engine and the ephemeral SQLite engine.
    "Today" is the most recent receipt date present in the data, so the numbers
    are meaningful for historical / uploaded datasets too.
    """
    # Imported lazily to avoid a circular import (inventory -> sql_compat only).
    from app.services.inventory import find_low_stock

    sql = text(
        """
        SELECT r.date AS d, COALESCE(SUM(si.net_sales), 0) AS net
        FROM receipts r
        JOIN sales_items si ON si.receipt_id = r.id
        WHERE r.status = 'Closed'
        GROUP BY r.date
        ORDER BY r.date DESC
        LIMIT 2
        """
    )
    with eng.connect() as conn:
        trans = conn.begin()
        try:
            _set_read_only(conn)
            rows = conn.execute(sql).mappings().all()
        finally:
            trans.rollback()

    todays_sales = float(rows[0]["net"]) if rows else 0.0
    prev_sales = float(rows[1]["net"]) if len(rows) > 1 else 0.0
    delta_pct = ((todays_sales - prev_sales) / prev_sales * 100.0) if prev_sales else 0.0

    low = find_low_stock(eng=eng)
    pending_deliveries = len({item["store_id"] for item in low})

    return {
        "todays_sales": todays_sales,
        "todays_sales_delta_pct": round(delta_pct, 1),
        "low_stock_alerts": len(low),
        "pending_deliveries": pending_deliveries,
    }
