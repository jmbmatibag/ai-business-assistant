"""End-of-Day aggregation worker.

Reads raw ``receipts`` / ``sales_items`` from the live POS database (via the
dynamic data-source router) for a given day, computes per-store / per-category
totals, and writes them to ``daily_sales_summaries`` in the application database.

The multi-period analytics endpoints read only from that summary table, keeping
quarterly/annual queries fast and off the live transaction tables.

Run nightly at close of business:

    python -m scripts.eod_summary                 # summarize the latest data date
    python -m scripts.eod_summary --date 2026-06-27
    python -m scripts.eod_summary --backfill      # summarize every date present

The script is idempotent: it replaces all summary rows for each processed date.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import delete, text

from app.db.session import SessionLocal
from app.models.daily_sales_summary import DailySalesSummary
from app.services.data_source import get_pos_engine


def _latest_date(pos_eng) -> date | None:
    with pos_eng.connect() as conn:
        row = conn.execute(text("SELECT MAX(date) AS d FROM receipts")).mappings().one()
    return row["d"]


def _all_dates(pos_eng) -> list[date]:
    with pos_eng.connect() as conn:
        rows = conn.execute(
            text("SELECT DISTINCT date FROM receipts WHERE date IS NOT NULL ORDER BY date")
        ).mappings().all()
    return [r["date"] for r in rows]


def summarize_date(summary_date: date) -> int:
    """Compute and persist summaries for one day. Returns rows written."""
    pos_eng = get_pos_engine()

    # Per (store, category) sales for completed receipts.
    sales_sql = text(
        """
        SELECT r.store_id AS store_id,
               COALESCE(si.category, '') AS category,
               COALESCE(SUM(si.quantity), 0) AS qty,
               COALESCE(SUM(si.net_sales), 0) AS net_sales,
               COALESCE(SUM(si.gross_profit), 0) AS gross_profit
        FROM receipts r
        JOIN sales_items si ON si.receipt_id = r.id
        WHERE r.status = 'Closed' AND r.date = :d
        GROUP BY r.store_id, COALESCE(si.category, '')
        """
    )
    # Per store cancelled-receipt counts.
    cancelled_sql = text(
        """
        SELECT store_id, COUNT(*) AS cancelled
        FROM receipts
        WHERE status = 'Cancelled' AND date = :d
        GROUP BY store_id
        """
    )

    with pos_eng.connect() as conn:
        sales_rows = conn.execute(sales_sql, {"d": summary_date}).mappings().all()
        cancelled_rows = conn.execute(cancelled_sql, {"d": summary_date}).mappings().all()

    # Key sales aggregates by (store_id, category).
    agg: dict[tuple[int, str], dict] = {}
    for row in sales_rows:
        agg[(row["store_id"], row["category"])] = {
            "quantity": int(row["qty"] or 0),
            "net_sales": Decimal(row["net_sales"] or 0),
            "gross_profit": Decimal(row["gross_profit"] or 0),
            "cancelled": 0,
        }

    # Attach cancelled counts to the store's "" category row (create if absent).
    for row in cancelled_rows:
        key = (row["store_id"], "")
        entry = agg.setdefault(
            key,
            {
                "quantity": 0,
                "net_sales": Decimal(0),
                "gross_profit": Decimal(0),
                "cancelled": 0,
            },
        )
        entry["cancelled"] = int(row["cancelled"] or 0)

    db = SessionLocal()
    try:
        # Idempotent replace for this date.
        db.execute(
            delete(DailySalesSummary).where(
                DailySalesSummary.summary_date == summary_date
            )
        )
        for (store_id, category), v in agg.items():
            db.add(
                DailySalesSummary(
                    summary_date=summary_date,
                    store_id=store_id,
                    category=category,
                    total_quantity_sold=v["quantity"],
                    total_net_sales=v["net_sales"],
                    total_cancelled_receipts=v["cancelled"],
                    total_gross_profit=v["gross_profit"],
                )
            )
        db.commit()
        return len(agg)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute EOD sales summaries.")
    parser.add_argument(
        "--date", type=str, default=None, help="Day to summarize (YYYY-MM-DD)."
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Summarize every distinct receipt date in the data.",
    )
    args = parser.parse_args()

    pos_eng = get_pos_engine()

    if args.backfill:
        dates = _all_dates(pos_eng)
        if not dates:
            print("No receipt dates found; nothing to summarize.")
            return
        total = 0
        for d in dates:
            written = summarize_date(d)
            total += written
            print(f"  {d}: {written} summary rows")
        print(f"Backfill complete: {len(dates)} dates, {total} rows.")
        return

    if args.date:
        target = datetime.strptime(args.date, "%Y-%m-%d").date()
    else:
        target = _latest_date(pos_eng)
        if target is None:
            print("No receipt data found; nothing to summarize.")
            return

    written = summarize_date(target)
    print(f"Summarized {target}: {written} summary rows.")


if __name__ == "__main__":
    main()
