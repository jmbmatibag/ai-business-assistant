"""ML analytical ingestion pipeline.

This module provides the continuous-improvement data path. Each function
reads from the transactional tables (receipts, sales_items) and writes
derived signals into the ml_* tables.

Execution model
---------------
- Functions are designed to be called by a scheduled job (cron / Celery beat)
  or manually triggered from the admin API.
- Every function is idempotent: calling it twice for the same date range is
  safe — it upserts rather than double-inserts.
- The pipeline runs in this order:
    1. ingest_historical_sales()       -- pull raw velocity from receipts
    2. update_consumption_curves()     -- compute rolling averages
    3. update_seasonal_patterns()      -- extract day-of-week/month multipliers
    4. compute_deviation_deltas()      -- compare prior forecasts to actuals
    5. apply_promotional_multipliers() -- inflate forecasts during promo windows
    6. apply_manual_overrides()        -- blend operator corrections into velocity
    7. emit_forecast_records()         -- write new forecast rows for next period

Each step returns a summary dict so callers can log progress.
"""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from sqlalchemy import text, func, select, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import Engine

from app.db.session import engine as default_engine
from app.models.ml_analytics import (
    ConsumptionCurve,
    DeliveryExecution,
    ForecastRecord,
    ManualOverride,
    PromotionalEvent,
    SeasonalPattern,
)

log = logging.getLogger(__name__)

# EWM smoothing factor (0 < alpha ≤ 1). Higher = more weight to recent data.
_EWM_ALPHA = 0.3

# Default rolling window for raw velocity averages.
_DEFAULT_WINDOW_DAYS = 30


# ---------------------------------------------------------------------------
# 1. Ingest historical sales → raw daily quantities per SKU per store
# ---------------------------------------------------------------------------

def ingest_historical_sales(
    *,
    eng: Engine | None = None,
    since: date | None = None,
    until: date | None = None,
) -> dict[str, Any]:
    """Read closed receipts and aggregate daily sold quantities per (store, sku).

    Returns:
        {"rows_processed": int, "date_range": [since, until]}
    """
    eng = eng or default_engine
    until = until or date.today()
    since = since or (until - timedelta(days=_DEFAULT_WINDOW_DAYS))

    sql = text("""
        SELECT
            r.store_id,
            si.sku,
            MAX(si.item_name)       AS item_name,
            r.date                  AS sale_date,
            SUM(si.quantity)        AS daily_qty
        FROM receipts r
        JOIN sales_items si ON si.receipt_id = r.id
        WHERE r.status = 'Closed'
          AND r.date BETWEEN :since AND :until
        GROUP BY r.store_id, si.sku, r.date
        ORDER BY r.store_id, si.sku, r.date
    """)

    with eng.connect() as conn:
        rows = conn.execute(sql, {"since": since, "until": until}).mappings().all()

    log.info("ingest_historical_sales: %d aggregated rows (%s → %s)", len(rows), since, until)
    return {"rows_processed": len(rows), "date_range": [str(since), str(until)]}


# ---------------------------------------------------------------------------
# 2. Update consumption curves (rolling avg + EWM smoothing)
# ---------------------------------------------------------------------------

def update_consumption_curves(
    *,
    eng: Engine | None = None,
    window_days: int = _DEFAULT_WINDOW_DAYS,
    alpha: float = _EWM_ALPHA,
) -> dict[str, Any]:
    """Compute rolling velocity averages and upsert into ml_consumption_curves.

    For each (store_id, sku) computes:
      - raw_avg_daily_qty:  arithmetic mean over `window_days`
      - smoothed_velocity:  exponentially weighted update from the prior value

    Returns:
        {"upserted": int}
    """
    eng = eng or default_engine
    until = date.today()
    since = until - timedelta(days=window_days)

    agg_sql = text("""
        SELECT
            r.store_id,
            si.sku,
            MAX(si.item_name)           AS item_name,
            AVG(si.quantity)            AS raw_avg,
            COUNT(DISTINCT r.date)      AS obs_count,
            MAX(r.date)                 AS last_sale_date
        FROM receipts r
        JOIN sales_items si ON si.receipt_id = r.id
        WHERE r.status = 'Closed'
          AND r.date BETWEEN :since AND :until
        GROUP BY r.store_id, si.sku
    """)

    upserted = 0
    with eng.begin() as conn:
        rows = conn.execute(agg_sql, {"since": since, "until": until}).mappings().all()

        for row in rows:
            # Fetch prior smoothed_velocity for EWM update
            existing = conn.execute(
                text(
                    "SELECT smoothed_velocity FROM ml_consumption_curves "
                    "WHERE store_id = :sid AND sku = :sku"
                ),
                {"sid": row["store_id"], "sku": row["sku"]},
            ).fetchone()

            prior = existing[0] if existing and existing[0] is not None else row["raw_avg"]
            smoothed = alpha * row["raw_avg"] + (1 - alpha) * prior

            conn.execute(
                text("""
                    INSERT INTO ml_consumption_curves
                        (store_id, sku, item_name, raw_avg_daily_qty, smoothed_velocity,
                         window_days, last_updated, observation_count)
                    VALUES
                        (:sid, :sku, :name, :raw, :smooth, :win, :last, :obs)
                    ON CONFLICT (store_id, sku) DO UPDATE SET
                        item_name           = EXCLUDED.item_name,
                        raw_avg_daily_qty   = EXCLUDED.raw_avg_daily_qty,
                        smoothed_velocity   = EXCLUDED.smoothed_velocity,
                        window_days         = EXCLUDED.window_days,
                        last_updated        = EXCLUDED.last_updated,
                        observation_count   = EXCLUDED.observation_count
                """),
                {
                    "sid":    row["store_id"],
                    "sku":    row["sku"],
                    "name":   row["item_name"],
                    "raw":    float(row["raw_avg"]),
                    "smooth": smoothed,
                    "win":    window_days,
                    "last":   row["last_sale_date"],
                    "obs":    row["obs_count"],
                },
            )
            upserted += 1

    log.info("update_consumption_curves: %d rows upserted", upserted)
    return {"upserted": upserted}


# ---------------------------------------------------------------------------
# 3. Update seasonal patterns (day-of-week + month multipliers)
# ---------------------------------------------------------------------------

def update_seasonal_patterns(
    *,
    eng: Engine | None = None,
    lookback_days: int = 180,
) -> dict[str, Any]:
    """Derive demand multipliers per (store, sku) for day-of-week and month.

    Algorithm:
      1. Compute avg daily qty per pattern bucket.
      2. Divide by the overall avg to get a ratio (multiplier).
      3. Upsert into ml_seasonal_patterns.

    Returns:
        {"patterns_written": int}
    """
    eng = eng or default_engine
    until = date.today()
    since = until - timedelta(days=lookback_days)

    patterns_sql = text("""
        SELECT
            r.store_id,
            si.sku,
            EXTRACT(DOW FROM r.date)::int   AS dow,
            EXTRACT(MONTH FROM r.date)::int AS month,
            AVG(si.quantity)                AS avg_qty
        FROM receipts r
        JOIN sales_items si ON si.receipt_id = r.id
        WHERE r.status = 'Closed'
          AND r.date BETWEEN :since AND :until
        GROUP BY r.store_id, si.sku, EXTRACT(DOW FROM r.date), EXTRACT(MONTH FROM r.date)
    """)

    overall_sql = text("""
        SELECT r.store_id, si.sku, AVG(si.quantity) AS overall_avg
        FROM receipts r
        JOIN sales_items si ON si.receipt_id = r.id
        WHERE r.status = 'Closed'
          AND r.date BETWEEN :since AND :until
        GROUP BY r.store_id, si.sku
    """)

    written = 0
    with eng.begin() as conn:
        patterns = conn.execute(patterns_sql, {"since": since, "until": until}).mappings().all()
        overalls = {
            (r["store_id"], r["sku"]): float(r["overall_avg"])
            for r in conn.execute(overall_sql, {"since": since, "until": until}).mappings().all()
        }

        for p in patterns:
            key = (p["store_id"], p["sku"])
            baseline = overalls.get(key, 1.0) or 1.0
            dow_mult = float(p["avg_qty"]) / baseline
            month_mult = dow_mult  # Same data point; split by type key below

            for ptype, pkey, mult in [
                ("day_of_week", str(p["dow"]),   dow_mult),
                ("month",       str(p["month"]), month_mult),
            ]:
                conn.execute(
                    text("""
                        INSERT INTO ml_seasonal_patterns
                            (store_id, sku, pattern_type, pattern_key, multiplier,
                             observation_count, last_updated)
                        VALUES
                            (:sid, :sku, :pt, :pk, :mult, 1, :today)
                        ON CONFLICT (store_id, sku, pattern_type, pattern_key) DO UPDATE SET
                            multiplier         = (ml_seasonal_patterns.multiplier *
                                                  ml_seasonal_patterns.observation_count + EXCLUDED.multiplier)
                                                 / (ml_seasonal_patterns.observation_count + 1),
                            observation_count  = ml_seasonal_patterns.observation_count + 1,
                            last_updated       = EXCLUDED.last_updated
                    """),
                    {
                        "sid":   p["store_id"],
                        "sku":   p["sku"],
                        "pt":    ptype,
                        "pk":    pkey,
                        "mult":  mult,
                        "today": until,
                    },
                )
                written += 1

    log.info("update_seasonal_patterns: %d patterns written", written)
    return {"patterns_written": written}


# ---------------------------------------------------------------------------
# 4. Compute deviation deltas on past forecasts
# ---------------------------------------------------------------------------

def compute_deviation_deltas(
    *,
    eng: Engine | None = None,
) -> dict[str, Any]:
    """Back-fill deviation_delta and ape_pct on ForecastRecords where actual data
    is now available but deviations have not yet been calculated.

    Returns:
        {"updated": int, "mean_ape": float | None}
    """
    eng = eng or default_engine

    pending_sql = text("""
        SELECT
            fr.id,
            fr.store_id,
            fr.sku,
            fr.forecast_date,
            fr.target_days,
            fr.predicted_qty,
            COALESCE(SUM(si.quantity), 0) AS actual_qty
        FROM ml_forecast_records fr
        LEFT JOIN receipts r
            ON r.store_id = fr.store_id
           AND r.date BETWEEN fr.forecast_date AND fr.forecast_date + fr.target_days
           AND r.status = 'Closed'
        LEFT JOIN sales_items si
            ON si.receipt_id = r.id AND si.sku = fr.sku
        WHERE fr.actual_qty IS NULL
          AND fr.forecast_date <= :today
        GROUP BY fr.id, fr.store_id, fr.sku, fr.forecast_date, fr.target_days, fr.predicted_qty
    """)

    updated = 0
    apes: list[float] = []

    with eng.begin() as conn:
        rows = conn.execute(pending_sql, {"today": date.today()}).mappings().all()

        for row in rows:
            actual = float(row["actual_qty"])
            predicted = float(row["predicted_qty"])
            delta = actual - predicted
            ape = abs(delta / actual * 100) if actual != 0 else 0.0

            conn.execute(
                text("""
                    UPDATE ml_forecast_records
                    SET actual_qty       = :actual,
                        deviation_delta  = :delta,
                        ape_pct          = :ape
                    WHERE id = :id
                """),
                {"actual": actual, "delta": delta, "ape": ape, "id": row["id"]},
            )
            apes.append(ape)
            updated += 1

    mean_ape = sum(apes) / len(apes) if apes else None
    log.info("compute_deviation_deltas: %d updated, mean APE=%.1f%%", updated, mean_ape or 0)
    return {"updated": updated, "mean_ape": mean_ape}


# ---------------------------------------------------------------------------
# 5. Apply promotional multipliers to forecasts
# ---------------------------------------------------------------------------

def apply_promotional_multipliers(
    *,
    eng: Engine | None = None,
    target_date: date | None = None,
) -> dict[str, Any]:
    """Return active promotional multipliers for a given date.

    The replenishment engine should call this and multiply the base velocity
    before computing order quantities.

    Returns:
        {"promotions": list[{store_id, sku, multiplier}]}
    """
    eng = eng or default_engine
    today = target_date or date.today()

    sql = text("""
        SELECT store_id, sku, name, demand_uplift_multiplier
        FROM ml_promotional_events
        WHERE start_date <= :today AND end_date >= :today
        ORDER BY store_id, sku
    """)

    with eng.connect() as conn:
        rows = conn.execute(sql, {"today": today}).mappings().all()

    result = [
        {
            "store_id":    r["store_id"],
            "sku":         r["sku"],
            "name":        r["name"],
            "multiplier":  float(r["demand_uplift_multiplier"]),
        }
        for r in rows
    ]
    log.info("apply_promotional_multipliers: %d active promotions for %s", len(result), today)
    return {"promotions": result}


# ---------------------------------------------------------------------------
# 6. Apply manual overrides to velocity estimates
# ---------------------------------------------------------------------------

def apply_manual_overrides(
    *,
    eng: Engine | None = None,
    target_date: date | None = None,
) -> dict[str, Any]:
    """Return active manual overrides blended into velocity.

    Velocity = (weight_pct / 100) * override_qty +
               (1 - weight_pct / 100) * smoothed_velocity_from_ml

    Returns:
        {"overrides": list[{store_id, sku, blended_velocity}]}
    """
    eng = eng or default_engine
    today = target_date or date.today()

    sql = text("""
        SELECT
            mo.store_id,
            mo.sku,
            mo.override_daily_qty,
            mo.weight_pct,
            cc.smoothed_velocity
        FROM ml_manual_overrides mo
        LEFT JOIN ml_consumption_curves cc
            ON cc.store_id = mo.store_id AND cc.sku = mo.sku
        WHERE mo.effective_from <= :today
          AND (mo.effective_until IS NULL OR mo.effective_until >= :today)
    """)

    with eng.connect() as conn:
        rows = conn.execute(sql, {"today": today}).mappings().all()

    overrides = []
    for r in rows:
        ml_vel = float(r["smoothed_velocity"] or r["override_daily_qty"])
        w = r["weight_pct"] / 100.0
        blended = w * float(r["override_daily_qty"]) + (1 - w) * ml_vel
        overrides.append({
            "store_id":        r["store_id"],
            "sku":             r["sku"],
            "blended_velocity": blended,
        })

    log.info("apply_manual_overrides: %d active overrides", len(overrides))
    return {"overrides": overrides}


# ---------------------------------------------------------------------------
# 7. Emit new forecast records for the next period
# ---------------------------------------------------------------------------

def emit_forecast_records(
    *,
    eng: Engine | None = None,
    target_days: int = 7,
    safety_stock_pct: int = 10,
    model_version: str = "mock-v1",
) -> dict[str, Any]:
    """Generate ForecastRecord rows for every (store, sku) with a known curve.

    Uses smoothed_velocity (with active overrides and promotional multipliers
    applied) to compute predicted_qty = velocity * target_days * safety_mult.

    Returns:
        {"records_emitted": int, "forecast_date": str}
    """
    eng = eng or default_engine
    today = date.today()
    safety_mult = 1 + safety_stock_pct / 100.0

    # Load active overrides and promos to blend into velocity
    overrides_res = apply_manual_overrides(eng=eng, target_date=today)
    promos_res = apply_promotional_multipliers(eng=eng, target_date=today)

    override_map: dict[tuple[int, str], float] = {
        (o["store_id"], o["sku"]): o["blended_velocity"]
        for o in overrides_res["overrides"]
        if o["store_id"] is not None
    }
    promo_map: dict[tuple[int | None, str | None], float] = {
        (p["store_id"], p["sku"]): p["multiplier"]
        for p in promos_res["promotions"]
    }

    curves_sql = text("""
        SELECT store_id, sku, item_name, smoothed_velocity, raw_avg_daily_qty
        FROM ml_consumption_curves
        WHERE smoothed_velocity IS NOT NULL
    """)

    emitted = 0
    with eng.begin() as conn:
        curves = conn.execute(curves_sql).mappings().all()

        for c in curves:
            sid, sku = c["store_id"], c["sku"]
            base_vel = override_map.get((sid, sku), float(c["smoothed_velocity"]))
            # Apply promotional uplift (chain-wide promos use None keys)
            promo_mult = promo_map.get((sid, sku), promo_map.get((None, sku), 1.0))
            adjusted_vel = base_vel * promo_mult
            predicted = adjusted_vel * target_days * safety_mult

            conn.execute(
                text("""
                    INSERT INTO ml_forecast_records
                        (store_id, sku, item_name, forecast_date, target_days,
                         predicted_qty, safety_stock_pct, model_version)
                    VALUES
                        (:sid, :sku, :name, :fdate, :tdays, :pred, :ss, :mv)
                    ON CONFLICT (store_id, sku, forecast_date) DO UPDATE SET
                        predicted_qty     = EXCLUDED.predicted_qty,
                        safety_stock_pct  = EXCLUDED.safety_stock_pct,
                        model_version     = EXCLUDED.model_version
                """),
                {
                    "sid":   sid,
                    "sku":   sku,
                    "name":  c["item_name"],
                    "fdate": today,
                    "tdays": target_days,
                    "pred":  predicted,
                    "ss":    safety_stock_pct,
                    "mv":    model_version,
                },
            )
            emitted += 1

    log.info("emit_forecast_records: %d records emitted for %s", emitted, today)
    return {"records_emitted": emitted, "forecast_date": str(today)}


# ---------------------------------------------------------------------------
# Full pipeline runner
# ---------------------------------------------------------------------------

def run_full_pipeline(
    *,
    eng: Engine | None = None,
    target_days: int = 7,
    safety_stock_pct: int = 10,
) -> dict[str, Any]:
    """Execute all pipeline stages in order and return a combined summary.

    Designed to be called from a scheduled job or an admin API endpoint.
    Each stage result is collected so callers can log or surface it.
    """
    results: dict[str, Any] = {}

    log.info("=== ML pipeline start ===")
    results["ingest"]   = ingest_historical_sales(eng=eng)
    results["curves"]   = update_consumption_curves(eng=eng)
    results["seasonal"] = update_seasonal_patterns(eng=eng)
    results["deltas"]   = compute_deviation_deltas(eng=eng)
    results["forecast"] = emit_forecast_records(
        eng=eng,
        target_days=target_days,
        safety_stock_pct=safety_stock_pct,
    )
    log.info("=== ML pipeline complete: %s ===", results)
    return results
