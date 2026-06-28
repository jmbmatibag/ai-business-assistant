"""Ephemeral, in-memory data engine for Local CSV mode.

When an operator switches to Local CSV mode and uploads one or more Loyverse-style
sales exports, those files are parsed and loaded into a private in-memory SQLite
database — one per user session. The schema mirrors the live POS tables
(``stores`` / ``receipts`` / ``sales_items``) plus the derived ``inventory_levels``
and ``daily_sales_summaries``, so every existing read path (the Claude SQL tools,
the inventory scanner, the analytics endpoints) works against it unchanged.

The data is **never** written to PostgreSQL. It lives only in process memory and
is dropped when the operator clears it, replaces it, or the backend restarts —
which is the intended, security-conscious behaviour for ad-hoc file analysis.
"""

from __future__ import annotations

import csv
import io
import threading
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models.daily_sales_summary import DailySalesSummary
from app.models.inventory import InventoryLevel
from app.models.receipt import Receipt
from app.models.sales_item import SalesItem
from app.models.store import Store

# Mirror the seeding heuristics so the dashboard/stock-out scanner have a
# realistic spread of on-hand stock to work with against uploaded data.
_COVER_CYCLE = [0.5, 1, 2, 6, 12]
_VELOCITY_WINDOW_DAYS = 14

# Loyverse export columns we read (matches scripts/seed.py).
_REQUIRED_COLUMNS = {"Store", "Receipt number"}


class EphemeralData:
    """Holds one user's in-memory engine plus a summary of what was loaded."""

    def __init__(self, engine: Engine, stats: dict) -> None:
        self.engine = engine
        self.stats = stats


# user_id -> EphemeralData. Guarded by a lock since uploads can race.
_sessions: dict[int, EphemeralData] = {}
_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Parsing helpers (kept in sync with scripts/seed.py)
# --------------------------------------------------------------------------- #
def _parse_date(raw: str) -> date | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _parse_decimal(raw: str) -> Decimal:
    raw = (raw or "").strip().replace(",", "")
    if not raw:
        return Decimal("0")
    try:
        return Decimal(raw)
    except InvalidOperation:
        return Decimal("0")


def _parse_int(raw: str) -> int:
    raw = (raw or "").strip().replace(",", "")
    if not raw:
        return 0
    try:
        return int(Decimal(raw))
    except (InvalidOperation, ValueError):
        return 0


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def _new_engine() -> Engine:
    """A single shared in-memory SQLite connection (StaticPool keeps one conn so
    the schema and data persist across calls within this process)."""
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(eng)
    return eng


def _load_rows(files: list[tuple[str, bytes]], db: Session) -> dict:
    """Parse every uploaded CSV into stores/receipts/sales_items.

    Multiple files are concatenated; receipts are de-duplicated by receipt
    number across all files (same rule as the seeder).
    """
    stores: dict[str, Store] = {}
    receipts: dict[str, Receipt] = {}
    files_summary: list[dict] = []
    items_created = 0

    for filename, blob in files:
        text = blob.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        fieldnames = set(reader.fieldnames or [])
        if not _REQUIRED_COLUMNS.issubset(fieldnames):
            files_summary.append(
                {
                    "filename": filename,
                    "rows": 0,
                    "skipped": True,
                    "reason": "Missing required columns (Store, Receipt number).",
                }
            )
            continue

        file_rows = 0
        for row in reader:
            store_name = (row.get("Store") or "").strip()
            receipt_number = (row.get("Receipt number") or "").strip()
            if not store_name or not receipt_number:
                continue

            store = stores.get(store_name)
            if store is None:
                store = Store(store_name=store_name)
                db.add(store)
                db.flush()
                stores[store_name] = store

            receipt = receipts.get(receipt_number)
            if receipt is None:
                receipt = Receipt(
                    receipt_number=receipt_number,
                    receipt_type=(row.get("Receipt type") or "").strip() or None,
                    date=_parse_date(row.get("Date", "")),
                    status=(row.get("Status") or "").strip() or "Closed",
                    store_id=store.id,
                )
                db.add(receipt)
                db.flush()
                receipts[receipt_number] = receipt

            db.add(
                SalesItem(
                    receipt_id=receipt.id,
                    category=(row.get("Category") or "").strip() or None,
                    sku=(row.get("SKU") or "").strip() or None,
                    item_name=(row.get("Item") or "").strip() or None,
                    quantity=_parse_int(row.get("Quantity", "")),
                    gross_sales=_parse_decimal(row.get("Gross sales", "")),
                    net_sales=_parse_decimal(row.get("Net sales", "")),
                    gross_profit=_parse_decimal(row.get("Gross profit", "")),
                )
            )
            items_created += 1
            file_rows += 1

        files_summary.append({"filename": filename, "rows": file_rows, "skipped": False})

    db.flush()
    return {
        "stores": len(stores),
        "receipts": len(receipts),
        "items": items_created,
        "files": files_summary,
    }


def _derive_inventory_and_summaries(db: Session) -> None:
    """Compute on-hand inventory levels and per-day sales summaries in Python.

    Done without dialect-specific SQL so it is robust on SQLite. Inventory is
    spread across a days-of-cover cycle (like the seeder) so some SKUs land below
    the reorder threshold and the stock-out scanner has something to surface.
    """
    receipts = {r.id: r for r in db.query(Receipt).all()}
    items = db.query(SalesItem).all()
    if not receipts:
        return

    max_date = max((r.date for r in receipts.values() if r.date), default=None)

    # --- Daily sales summaries (one row per store/day) ---
    summary: dict[tuple[int, date], dict] = defaultdict(
        lambda: {
            "qty": 0,
            "net": Decimal("0"),
            "profit": Decimal("0"),
        }
    )
    cancelled: dict[tuple[int, date], int] = defaultdict(int)
    for r in receipts.values():
        if r.date is None:
            continue
        if (r.status or "").lower() == "cancelled":
            cancelled[(r.store_id, r.date)] += 1

    for it in items:
        r = receipts.get(it.receipt_id)
        if r is None or r.date is None or (r.status or "").lower() != "closed":
            continue
        bucket = summary[(r.store_id, r.date)]
        bucket["qty"] += it.quantity or 0
        bucket["net"] += it.net_sales or Decimal("0")
        bucket["profit"] += it.gross_profit or Decimal("0")

    keys = set(summary) | set(cancelled)
    for store_id, day in keys:
        b = summary.get((store_id, day), {"qty": 0, "net": Decimal("0"), "profit": Decimal("0")})
        db.add(
            DailySalesSummary(
                summary_date=day,
                store_id=store_id,
                category="",
                total_quantity_sold=b["qty"],
                total_net_sales=b["net"],
                total_gross_profit=b["profit"],
                total_cancelled_receipts=cancelled.get((store_id, day), 0),
            )
        )

    # --- Inventory levels (velocity over trailing window -> on-hand) ---
    if max_date is not None:
        since = max_date - timedelta(days=_VELOCITY_WINDOW_DAYS)
        velocity: dict[tuple[int, str], dict] = defaultdict(
            lambda: {"qty": 0, "item_name": None, "category": None}
        )
        for it in items:
            r = receipts.get(it.receipt_id)
            if r is None or r.date is None or (r.status or "").lower() != "closed":
                continue
            if not it.sku or r.date < since:
                continue
            v = velocity[(r.store_id, it.sku)]
            v["qty"] += it.quantity or 0
            v["item_name"] = v["item_name"] or it.item_name
            v["category"] = v["category"] or it.category

        for i, ((store_id, sku), v) in enumerate(velocity.items()):
            daily = v["qty"] / _VELOCITY_WINDOW_DAYS
            cover = _COVER_CYCLE[i % len(_COVER_CYCLE)]
            db.add(
                InventoryLevel(
                    store_id=store_id,
                    sku=sku,
                    item_name=v["item_name"],
                    category=v["category"],
                    quantity=max(0, round(daily * cover)),
                )
            )

    db.flush()


def load_csv_files(user_id: int, files: list[tuple[str, bytes]]) -> dict:
    """Build a fresh ephemeral engine for ``user_id`` from the uploaded files.

    Replaces any existing ephemeral data for that user. Returns load stats.
    """
    eng = _new_engine()
    with Session(bind=eng) as db:
        stats = _load_rows(files, db)
        _derive_inventory_and_summaries(db)
        db.commit()

    if stats["items"] == 0:
        eng.dispose()
        raise ValueError(
            "No usable rows found in the uploaded file(s). Expected Loyverse-style "
            "columns: Store, Receipt number, Date, Status, SKU, Item, Quantity, "
            "Net sales, Gross profit."
        )

    with _lock:
        old = _sessions.pop(user_id, None)
        if old is not None:
            old.engine.dispose()
        _sessions[user_id] = EphemeralData(eng, stats)
    return stats


def get_ephemeral_engine(user_id: int) -> Engine | None:
    """The user's in-memory engine, or None if they haven't uploaded CSVs."""
    data = _sessions.get(user_id)
    return data.engine if data is not None else None


def get_ephemeral_status(user_id: int) -> dict | None:
    """Load summary for the user's ephemeral data, or None if not loaded."""
    data = _sessions.get(user_id)
    return data.stats if data is not None else None


def clear_ephemeral(user_id: int) -> bool:
    """Drop the user's ephemeral data. Returns True if anything was cleared."""
    with _lock:
        data = _sessions.pop(user_id, None)
    if data is None:
        return False
    data.engine.dispose()
    return True
