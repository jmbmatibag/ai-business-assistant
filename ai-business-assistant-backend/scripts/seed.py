"""Seed the database with demo POS data.

By default this generates a self-contained **synthetic** dataset for two Makati
branches (``MAKATI 1`` / ``MAKATI 2``) with premium-cafe products and financial
baselines that are deliberately distinct from ``data/dummy_sales_cavite.csv`` —
so that toggling the Database vs. CSV sources in the demo produces obviously
different numbers.

It populates every table the dashboard reads:

    stores                 <- MAKATI 1 / MAKATI 2
    receipts / sales_items <- ~13 months of daily transactions (some Cancelled)
    inventory_levels       <- on-hand stock derived from recent velocity
    daily_sales_summaries  <- EOD rollups (so the trend charts populate)

Run after the schema migration:

    python -m scripts.seed --reset            # flush + reseed synthetic MAKATI data
    python -m scripts.seed --reset --csv data/dummy_sales_cavite.csv   # seed from a CSV

The script is idempotent with ``--reset`` (it flushes first). Without ``--reset``
it skips rows / receipts that already exist.
"""

from __future__ import annotations

import argparse
import csv
import random
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import delete, select, text

from app.db.session import SessionLocal
from app.models.daily_sales_summary import DailySalesSummary
from app.models.inventory import InventoryLevel
from app.models.receipt import Receipt
from app.models.sales_item import SalesItem
from app.models.store import Store

# Days-of-cover cycle used to spread seeded on-hand stock across the low/healthy
# spectrum, so the dashboard and stock-out scanner have realistic data to show.
_COVER_CYCLE = [0.5, 1, 2, 6, 12]
_VELOCITY_WINDOW_DAYS = 14

DEFAULT_CSV = Path(__file__).resolve().parent.parent / "data" / "dummy_sales_cavite.csv"

# --- Synthetic MAKATI demo dataset --------------------------------------------

# ~13 months of history so the monthly trend chart fills its 12 buckets.
_DAYS_BACK = 400

# Premium Makati-CBD catalogue, intentionally unlike the Cavite grocery sheet.
# (sku, item_name, category, unit_price, unit_cost)
_CATALOG: list[tuple[str, str, str, int, int]] = [
    ("MK-ESP", "Single-Origin Espresso", "Beverages", 180, 60),
    ("MK-LAT", "Salted Caramel Latte", "Beverages", 220, 75),
    ("MK-COLD", "Cold Brew 1L", "Beverages", 320, 110),
    ("MK-CRO", "Butter Croissant", "Bakery", 150, 50),
    ("MK-BAG", "Everything Bagel", "Bakery", 130, 45),
    ("MK-SAND", "Truffle Club Sandwich", "Food", 380, 140),
    ("MK-SAL", "Quinoa Power Bowl", "Food", 420, 160),
    ("MK-CAKE", "New York Cheesecake", "Desserts", 260, 90),
    ("MK-BEAN", "Premium Beans 250g", "Retail", 650, 300),
    ("MK-MUG", "Ceramic Tumbler", "Retail", 750, 350),
]

# Per-branch demand profile. MAKATI 1 is the higher-volume flagship; MAKATI 2 is
# a smaller satellite — giving each store a distinct financial baseline.
_STORE_PROFILES: dict[str, dict] = {
    "MAKATI 1": {"receipts": (7, 13), "items": (1, 4), "qty": (1, 3)},
    "MAKATI 2": {"receipts": (3, 7), "items": (1, 3), "qty": (1, 2)},
}


def parse_date(raw: str) -> date | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def parse_decimal(raw: str) -> Decimal:
    raw = (raw or "").strip().replace(",", "")
    if not raw:
        return Decimal("0")
    try:
        return Decimal(raw)
    except InvalidOperation:
        return Decimal("0")


def parse_int(raw: str) -> int:
    raw = (raw or "").strip().replace(",", "")
    if not raw:
        return 0
    try:
        return int(Decimal(raw))
    except (InvalidOperation, ValueError):
        return 0


def reset_data(db) -> None:
    db.execute(delete(DailySalesSummary))
    db.execute(delete(InventoryLevel))
    db.execute(delete(SalesItem))
    db.execute(delete(Receipt))
    db.execute(delete(Store))
    db.commit()
    print(
        "Cleared daily_sales_summaries, inventory_levels, sales_items, "
        "receipts and stores."
    )


def seed_inventory(db) -> int:
    """Derive on-hand stock per (store, sku) from recent sales velocity.

    Quantities are spread across a days-of-cover cycle so some SKUs sit below the
    reorder threshold (feeding the stock-out scanner) and others stay healthy.
    """
    db.execute(delete(InventoryLevel))

    ref = db.execute(text("SELECT MAX(date) FROM receipts")).scalar()
    if ref is None:
        return 0
    since = ref - timedelta(days=_VELOCITY_WINDOW_DAYS)

    rows = db.execute(
        text(
            """
            SELECT r.store_id AS store_id,
                   si.sku AS sku,
                   MAX(si.item_name) AS item_name,
                   MAX(si.category) AS category,
                   SUM(si.quantity)::float / :days AS daily_velocity
            FROM sales_items si
            JOIN receipts r ON r.id = si.receipt_id
            WHERE r.status = 'Closed' AND r.date >= :since AND si.sku IS NOT NULL
            GROUP BY r.store_id, si.sku
            """
        ),
        {"days": _VELOCITY_WINDOW_DAYS, "since": since},
    ).mappings().all()

    created = 0
    for i, row in enumerate(rows):
        velocity = float(row["daily_velocity"] or 0)
        cover = _COVER_CYCLE[i % len(_COVER_CYCLE)]
        qty = max(0, round(velocity * cover))
        db.add(
            InventoryLevel(
                store_id=row["store_id"],
                sku=row["sku"],
                item_name=row["item_name"],
                category=row["category"],
                quantity=qty,
            )
        )
        created += 1
    db.commit()
    return created


def write_summaries(db) -> int:
    """Recompute daily_sales_summaries from the raw receipts in the database.

    The analytics trend charts read only from this table, so a fresh seed must
    populate it. Mirrors scripts/eod_summary but runs in one pass over all dates.
    """
    db.execute(delete(DailySalesSummary))

    sales_rows = db.execute(
        text(
            """
            SELECT r.date AS d, r.store_id AS store_id,
                   COALESCE(si.category, '') AS category,
                   COALESCE(SUM(si.quantity), 0) AS qty,
                   COALESCE(SUM(si.net_sales), 0) AS net_sales,
                   COALESCE(SUM(si.gross_profit), 0) AS gross_profit
            FROM receipts r
            JOIN sales_items si ON si.receipt_id = r.id
            WHERE r.status = 'Closed' AND r.date IS NOT NULL
            GROUP BY r.date, r.store_id, COALESCE(si.category, '')
            """
        )
    ).mappings().all()

    cancelled_rows = db.execute(
        text(
            """
            SELECT date AS d, store_id, COUNT(*) AS cancelled
            FROM receipts
            WHERE status = 'Cancelled' AND date IS NOT NULL
            GROUP BY date, store_id
            """
        )
    ).mappings().all()

    agg: dict[tuple, dict] = {}
    for row in sales_rows:
        agg[(row["d"], row["store_id"], row["category"])] = {
            "quantity": int(row["qty"] or 0),
            "net_sales": Decimal(row["net_sales"] or 0),
            "gross_profit": Decimal(row["gross_profit"] or 0),
            "cancelled": 0,
        }
    for row in cancelled_rows:
        key = (row["d"], row["store_id"], "")
        entry = agg.setdefault(
            key,
            {"quantity": 0, "net_sales": Decimal(0), "gross_profit": Decimal(0), "cancelled": 0},
        )
        entry["cancelled"] = int(row["cancelled"] or 0)

    for (summary_date, store_id, category), v in agg.items():
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


def generate_demo(db) -> tuple[int, int, int]:
    """Generate synthetic MAKATI 1 / MAKATI 2 transactions. Returns counts."""
    rng = random.Random(42)
    today = date.today()
    start = today - timedelta(days=_DAYS_BACK)

    # Stores
    stores: dict[str, Store] = {}
    for name in _STORE_PROFILES:
        store = Store(store_name=name)
        db.add(store)
        stores[name] = store
    db.flush()  # assign ids

    receipts_created = 0
    items_created = 0
    seq = 0

    day = start
    while day <= today:
        # Weekends lift footfall in the CBD cafes.
        weekend = day.weekday() >= 5
        for name, profile in _STORE_PROFILES.items():
            store = stores[name]
            lo, hi = profile["receipts"]
            count = rng.randint(lo, hi)
            if weekend:
                count = int(count * 1.35)
            for _ in range(count):
                seq += 1
                # ~6% of receipts are cancelled (operational-anomaly signal).
                cancelled = rng.random() < 0.06
                receipt = Receipt(
                    receipt_number=f"MK-{store.id}-{seq:07d}",
                    receipt_type="Sale",
                    date=day,
                    status="Cancelled" if cancelled else "Closed",
                    store_id=store.id,
                )
                n_items = rng.randint(*profile["items"])
                chosen = rng.sample(_CATALOG, k=n_items)
                for sku, item_name, category, price, cost in chosen:
                    qty = rng.randint(*profile["qty"])
                    gross = Decimal(price * qty)
                    profit = Decimal((price - cost) * qty)
                    receipt.items.append(
                        SalesItem(
                            category=category,
                            sku=sku,
                            item_name=item_name,
                            quantity=qty,
                            gross_sales=gross,
                            net_sales=gross,
                            gross_profit=profit,
                        )
                    )
                    items_created += 1
                db.add(receipt)
                receipts_created += 1
        # Commit per-day to keep the session/transaction size bounded.
        if day.day == 1:
            db.commit()
        day += timedelta(days=1)

    db.commit()
    return len(stores), receipts_created, items_created


def seed_from_csv(db, csv_path: Path) -> tuple[int, int, int]:
    """Seed stores/receipts/sales_items from a Loyverse-style CSV export."""
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    stores: dict[str, Store] = {
        s.store_name: s for s in db.execute(select(Store)).scalars()
    }
    receipts: dict[str, Receipt] = {
        r.receipt_number: r for r in db.execute(select(Receipt)).scalars()
    }

    stores_created = receipts_created = items_created = rows_skipped = 0

    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            store_name = (row.get("Store") or "").strip()
            receipt_number = (row.get("Receipt number") or "").strip()
            if not store_name or not receipt_number:
                rows_skipped += 1
                continue

            store = stores.get(store_name)
            if store is None:
                store = Store(store_name=store_name)
                db.add(store)
                db.flush()
                stores[store_name] = store
                stores_created += 1

            receipt = receipts.get(receipt_number)
            if receipt is None:
                receipt = Receipt(
                    receipt_number=receipt_number,
                    receipt_type=(row.get("Receipt type") or "").strip() or None,
                    date=parse_date(row.get("Date", "")),
                    status=(row.get("Status") or "").strip(),
                    store_id=store.id,
                )
                db.add(receipt)
                db.flush()
                receipts[receipt_number] = receipt
                receipts_created += 1

            db.add(
                SalesItem(
                    receipt_id=receipt.id,
                    category=(row.get("Category") or "").strip() or None,
                    sku=(row.get("SKU") or "").strip() or None,
                    item_name=(row.get("Item") or "").strip() or None,
                    quantity=parse_int(row.get("Quantity", "")),
                    gross_sales=parse_decimal(row.get("Gross sales", "")),
                    net_sales=parse_decimal(row.get("Net sales", "")),
                    gross_profit=parse_decimal(row.get("Gross profit", "")),
                )
            )
            items_created += 1

    db.commit()
    if rows_skipped:
        print(f"  rows skipped (missing store/receipt): {rows_skipped}")
    return stores_created, receipts_created, items_created


def seed(reset: bool, csv_path: Path | None) -> None:
    db = SessionLocal()
    try:
        if reset:
            reset_data(db)

        if csv_path is not None:
            stores_created, receipts_created, items_created = seed_from_csv(db, csv_path)
            mode = f"CSV ({csv_path.name})"
        else:
            stores_created, receipts_created, items_created = generate_demo(db)
            mode = "synthetic MAKATI demo"

        inventory_created = seed_inventory(db)
        summary_rows = write_summaries(db)

        print(f"Seed complete ({mode}).")
        print(f"  stores:            {stores_created}")
        print(f"  receipts created:  {receipts_created}")
        print(f"  items created:     {items_created}")
        print(f"  inventory rows:    {inventory_created}")
        print(f"  summary rows:      {summary_rows}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the AIBA database.")
    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Seed from a CSV export instead of generating synthetic demo data. "
        f"Use {DEFAULT_CSV.name} to load the Cavite dataset.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete existing stores/receipts/sales_items/summaries before seeding.",
    )
    args = parser.parse_args()
    seed(reset=args.reset, csv_path=args.csv)


if __name__ == "__main__":
    main()
