"""Seed the database from the dummy POS sales export.

Reads ``data/dummy_sales_cavite.csv`` and populates the relational tables:

    stores      <- distinct "Store" values
    receipts    <- distinct "Receipt number" (status preserved verbatim)
    sales_items <- one row per CSV line, linked to its receipt

Run after the schema migration:

    python -m scripts.seed

The script is idempotent: it skips rows whose receipt_number already exists,
so re-running will not create duplicates.

Usage:
    python -m scripts.seed [--csv PATH] [--reset]

    --reset   Delete existing sales_items / receipts / stores rows before seeding.
"""

from __future__ import annotations

import argparse
import csv
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.receipt import Receipt
from app.models.sales_item import SalesItem
from app.models.store import Store

DEFAULT_CSV = Path(__file__).resolve().parent.parent / "data" / "dummy_sales_cavite.csv"


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
    db.execute(delete(SalesItem))
    db.execute(delete(Receipt))
    db.execute(delete(Store))
    db.commit()
    print("Cleared existing sales_items, receipts and stores.")


def seed(csv_path: Path, reset: bool) -> None:
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    db = SessionLocal()
    try:
        if reset:
            reset_data(db)

        # Cache of store_name -> Store and receipt_number -> Receipt
        stores: dict[str, Store] = {
            s.store_name: s for s in db.execute(select(Store)).scalars()
        }
        receipts: dict[str, Receipt] = {
            r.receipt_number: r for r in db.execute(select(Receipt)).scalars()
        }

        stores_created = 0
        receipts_created = 0
        items_created = 0
        rows_skipped = 0

        with csv_path.open(newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                store_name = (row.get("Store") or "").strip()
                receipt_number = (row.get("Receipt number") or "").strip()
                if not store_name or not receipt_number:
                    rows_skipped += 1
                    continue

                # --- Store ---
                store = stores.get(store_name)
                if store is None:
                    store = Store(store_name=store_name)
                    db.add(store)
                    db.flush()  # assign id
                    stores[store_name] = store
                    stores_created += 1

                # --- Receipt (dedupe by receipt_number) ---
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

                # --- Sales item ---
                item = SalesItem(
                    receipt_id=receipt.id,
                    category=(row.get("Category") or "").strip() or None,
                    sku=(row.get("SKU") or "").strip() or None,
                    item_name=(row.get("Item") or "").strip() or None,
                    quantity=parse_int(row.get("Quantity", "")),
                    gross_sales=parse_decimal(row.get("Gross sales", "")),
                    net_sales=parse_decimal(row.get("Net sales", "")),
                    gross_profit=parse_decimal(row.get("Gross profit", "")),
                )
                db.add(item)
                items_created += 1

        db.commit()

        print("Seed complete.")
        print(f"  stores created:   {stores_created}")
        print(f"  receipts created: {receipts_created}")
        print(f"  items created:    {items_created}")
        if rows_skipped:
            print(f"  rows skipped (missing store/receipt): {rows_skipped}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the AIBA database from the POS CSV export.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="Path to the CSV export.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete existing stores/receipts/sales_items before seeding.",
    )
    args = parser.parse_args()
    seed(args.csv, args.reset)


if __name__ == "__main__":
    main()
