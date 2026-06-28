"""Inventory intelligence: sales velocity, stock-out risk, and replenishment.

All reads go through the live POS engine (resolved via the dynamic data-source
router), so they automatically follow whichever external database is active.
Writes (notification records) go to the application database.

Velocity is computed over a trailing window anchored to the most recent receipt
date in the data, so the logic works against historical/seeded data as well as a
truly live feed.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.db.session import engine as default_engine
from app.models.ai_settings import AISettings
from app.models.notification import (
    STATUS_UNREAD,
    TYPE_STOCKOUT_RISK,
    Notification,
)
from app.services.sql_compat import _set_read_only

# Trailing window (days) used to estimate average daily sales velocity.
VELOCITY_WINDOW_DAYS = 14
# A SKU is "at risk" when projected days of cover falls below this run-rate.
DEFAULT_REORDER_DAYS = 3


def _reference_date(eng: Engine) -> date | None:
    """Latest receipt date in the data — the anchor for the velocity window."""
    with eng.connect() as conn:
        row = conn.execute(text("SELECT MAX(date) AS d FROM receipts")).mappings().one()
    d = row["d"]
    # SQLite (ephemeral CSV engine) returns DATE columns as ISO strings, whereas
    # PostgreSQL returns native date objects. Normalise to a date either way.
    if isinstance(d, str):
        return date.fromisoformat(d)
    return d


def _stock_rows(eng: Engine, store_id: int | None) -> list[dict[str, Any]]:
    """Join current inventory to trailing sales velocity per (store, sku)."""
    ref = _reference_date(eng)
    if ref is None:
        return []
    since = ref - timedelta(days=VELOCITY_WINDOW_DAYS)

    sql = text(
        """
        WITH velocity AS (
            SELECT r.store_id AS store_id,
                   si.sku AS sku,
                   CAST(SUM(si.quantity) AS FLOAT) / :days AS daily_velocity,
                   MAX(si.item_name) AS item_name
            FROM sales_items si
            JOIN receipts r ON r.id = si.receipt_id
            WHERE r.status = 'Closed'
              AND r.date >= :since
              AND si.sku IS NOT NULL
            GROUP BY r.store_id, si.sku
        )
        SELECT s.id          AS store_id,
               s.store_name  AS store_name,
               inv.sku       AS sku,
               COALESCE(inv.item_name, v.item_name) AS item_name,
               inv.category  AS category,
               inv.quantity  AS current_stock,
               COALESCE(v.daily_velocity, 0) AS daily_velocity
        FROM inventory_levels inv
        JOIN stores s ON s.id = inv.store_id
        LEFT JOIN velocity v
               ON v.store_id = inv.store_id AND v.sku = inv.sku
        WHERE (:store_id IS NULL OR inv.store_id = :store_id)
        """
    )
    # SQLite compares DATE columns as ISO strings; bind the cutoff accordingly.
    since_param = since.isoformat() if eng.dialect.name == "sqlite" else since
    params = {"days": VELOCITY_WINDOW_DAYS, "since": since_param, "store_id": store_id}
    with eng.connect() as conn:
        trans = conn.begin()
        try:
            _set_read_only(conn)
            rows = [dict(r) for r in conn.execute(sql, params).mappings().all()]
        finally:
            trans.rollback()
    return rows


def find_low_stock(
    *,
    eng: Engine | None = None,
    store_id: int | None = None,
    reorder_days: int = DEFAULT_REORDER_DAYS,
) -> list[dict[str, Any]]:
    """Return SKUs whose projected days of cover is below ``reorder_days``.

    Each item: store_id, store_name, sku, item_name, category, current_stock,
    daily_velocity, days_until_stockout. Sorted most-urgent first.
    """
    eng = eng or default_engine
    out: list[dict[str, Any]] = []
    for row in _stock_rows(eng, store_id):
        velocity = float(row["daily_velocity"] or 0)
        if velocity <= 0:
            continue
        stock = int(row["current_stock"] or 0)
        days_cover = stock / velocity
        if days_cover >= reorder_days:
            continue
        out.append(
            {
                "store_id": row["store_id"],
                "store_name": row["store_name"],
                "sku": row["sku"],
                "item_name": row["item_name"],
                "category": row["category"],
                "current_stock": stock,
                "daily_velocity": round(velocity, 2),
                "days_until_stockout": round(days_cover, 2),
            }
        )
    out.sort(key=lambda r: r["days_until_stockout"])
    return out


def calculate_replenishment_matrix(
    *,
    store_id: int,
    target_days: int,
    eng: Engine | None = None,
    safety_stock_pct: int = 0,
) -> dict[str, Any]:
    """Compute required replenishment quantities for a store.

    Required Stock = (Daily Velocity * Target Days * (1 + safety%)) - Current Stock
    Only items with a positive requirement are returned.
    """
    eng = eng or default_engine
    multiplier = target_days * (1 + safety_stock_pct / 100.0)

    items: list[dict[str, Any]] = []
    store_name: str | None = None
    for row in _stock_rows(eng, store_id):
        store_name = row["store_name"]
        velocity = float(row["daily_velocity"] or 0)
        if velocity <= 0:
            continue
        stock = int(row["current_stock"] or 0)
        required = math.ceil(velocity * multiplier - stock)
        if required <= 0:
            continue
        items.append(
            {
                "sku": row["sku"],
                "item_name": row["item_name"],
                "category": row["category"],
                "current_stock": stock,
                "daily_velocity": round(velocity, 2),
                "required_quantity": required,
            }
        )

    items.sort(key=lambda r: r["required_quantity"], reverse=True)
    return {
        "store_id": store_id,
        "store_name": store_name,
        "target_days": target_days,
        "safety_stock_pct": safety_stock_pct,
        "item_count": len(items),
        "items": items,
    }


def resolve_store_id(eng: Engine, store_name: str) -> int | None:
    """Look up a store id by (case-insensitive) name."""
    with eng.connect() as conn:
        row = (
            conn.execute(
                text("SELECT id FROM stores WHERE LOWER(store_name) = LOWER(:n)"),
                {"n": store_name.strip()},
            )
            .mappings()
            .first()
        )
    return row["id"] if row else None


def scan_and_record_stockouts(
    *,
    app_db: Session,
    settings: AISettings,
    eng: Engine | None = None,
    reorder_days: int = DEFAULT_REORDER_DAYS,
) -> list[Notification]:
    """Scan for stock-out risk and persist one notification per affected store.

    De-duplicates against existing *unread* STOCKOUT_RISK notifications for the
    same store, so repeated scans don't spam the operator.
    """
    eng = eng or default_engine
    low = find_low_stock(eng=eng, reorder_days=reorder_days)
    if not low:
        return []

    # Group affected items by store.
    by_store: dict[int, list[dict[str, Any]]] = {}
    store_names: dict[int, str] = {}
    for item in low:
        by_store.setdefault(item["store_id"], []).append(item)
        store_names[item["store_id"]] = item["store_name"]

    # Stores that already have an unread stock-out notification — skip those.
    existing_store_ids = {
        nid
        for (nid,) in app_db.execute(
            text(
                "SELECT DISTINCT store_id FROM notifications "
                "WHERE type = :t AND status = :s AND store_id IS NOT NULL"
            ),
            {"t": TYPE_STOCKOUT_RISK, "s": STATUS_UNREAD},
        ).all()
    }

    created: list[Notification] = []
    for store_id, items in by_store.items():
        if store_id in existing_store_ids:
            continue
        store_name = store_names[store_id]
        top = items[:3]
        names = ", ".join(i["item_name"] or i["sku"] for i in top)
        more = "" if len(items) <= 3 else f" (+{len(items) - 3} more)"
        message = (
            f"{len(items)} item(s) at {store_name} are projected to run out within "
            f"{reorder_days} days: {names}{more}."
        )
        suggested = (
            f"Create a {reorder_days}-day replenishment plan for {store_name} "
            f"focusing on {names} to resolve the current low-stock warning."
        )
        notif = Notification(
            store_id=store_id,
            type=TYPE_STOCKOUT_RISK,
            message=message,
            suggested_prompt=suggested,
        )
        app_db.add(notif)
        created.append(notif)

    if created:
        app_db.commit()
        for n in created:
            app_db.refresh(n)
    return created
