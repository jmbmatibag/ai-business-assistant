"""Read-only database tools exposed to Claude via function calling.

Every tool is strictly read-only. The free-form SQL tool is double-guarded:
a SELECT-only validator *and* a `SET TRANSACTION READ ONLY` transaction that
is always rolled back, so even a validator bypass cannot mutate data.
"""

from __future__ import annotations

import re
from decimal import Decimal
from datetime import date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.db.session import engine
from app.models.ai_settings import AISettings

# Schema summary handed to Claude so it can write correct queries.
SCHEMA_DESCRIPTION = """\
Tables (PostgreSQL):
- stores(id, store_name)                         -- e.g. 'COTERIE 1'
- receipts(id, receipt_number, receipt_type, date, status, store_id)
    status is one of 'Closed' or 'Cancelled'. date is a DATE.
    store_id -> stores.id
- sales_items(id, receipt_id, category, sku, item_name, quantity,
              gross_sales, net_sales, gross_profit)
    receipt_id -> receipts.id. Money columns are NUMERIC(12,2).

Notes:
- A 'Cancelled' receipt is an operational signal, not a completed sale.
  Exclude cancelled receipts from revenue unless explicitly asked about them.
- Join sales_items -> receipts -> stores to attribute sales to a store/date.
"""

MAX_ROWS = 200

# Whole-word tokens that must never appear in a read-only query.
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|"
    r"copy|merge|call|do|vacuum|analyze|reindex|comment|lock|"
    r"into|nextval|setval|pg_sleep)\b",
    re.IGNORECASE,
)


class ToolError(Exception):
    """Raised when a tool cannot run; surfaced back to Claude as an error result."""


def _json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _validate_select(query: str) -> str:
    q = query.strip().rstrip(";").strip()
    if not q:
        raise ToolError("Empty query.")
    if ";" in q:
        raise ToolError("Only a single statement is allowed (no semicolons).")
    if not re.match(r"^(select|with)\b", q, re.IGNORECASE):
        raise ToolError("Only SELECT (or WITH ... SELECT) queries are allowed.")
    if _FORBIDDEN.search(q):
        raise ToolError("Query contains a disallowed keyword; reads only.")
    return q


def run_readonly_sql(args: dict[str, Any], *, eng: Engine = engine) -> dict[str, Any]:
    """Execute a single read-only SELECT and return rows (capped at MAX_ROWS)."""
    query = _validate_select(str(args.get("query", "")))

    # Cap result size unless the caller already constrained it.
    capped = query
    if not re.search(r"\blimit\b", query, re.IGNORECASE):
        capped = f"{query}\nLIMIT {MAX_ROWS}"

    with eng.connect() as conn:
        trans = conn.begin()
        try:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            result = conn.execute(text(capped))
            rows = [
                {k: _json_safe(v) for k, v in row.items()}
                for row in result.mappings().all()
            ]
        finally:
            trans.rollback()

    return {
        "row_count": len(rows),
        "truncated": len(rows) >= MAX_ROWS,
        "rows": rows,
    }


def get_sales_summary(args: dict[str, Any], *, eng: Engine = engine) -> dict[str, Any]:
    """Aggregate sales for completed (Closed) receipts, optionally filtered."""
    store_name = args.get("store_name")
    date_from = args.get("date_from")
    date_to = args.get("date_to")

    clauses = ["r.status = 'Closed'"]
    params: dict[str, Any] = {}
    if store_name:
        clauses.append("s.store_name = :store_name")
        params["store_name"] = store_name
    if date_from:
        clauses.append("r.date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        clauses.append("r.date <= :date_to")
        params["date_to"] = date_to

    where = " AND ".join(clauses)
    sql = f"""
        SELECT
            COUNT(DISTINCT r.id)            AS receipts,
            COALESCE(SUM(si.quantity), 0)   AS units,
            COALESCE(SUM(si.gross_sales),0) AS gross_sales,
            COALESCE(SUM(si.net_sales), 0)  AS net_sales,
            COALESCE(SUM(si.gross_profit),0) AS gross_profit
        FROM receipts r
        JOIN stores s ON s.id = r.store_id
        JOIN sales_items si ON si.receipt_id = r.id
        WHERE {where}
    """
    with eng.connect() as conn:
        trans = conn.begin()
        try:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            row = conn.execute(text(sql), params).mappings().one()
        finally:
            trans.rollback()

    return {
        "filters": {
            "store_name": store_name,
            "date_from": date_from,
            "date_to": date_to,
        },
        **{k: _json_safe(v) for k, v in row.items()},
    }


def scan_cancellation_anomalies(
    args: dict[str, Any],
    *,
    eng: Engine = engine,
    settings: AISettings | None = None,
) -> dict[str, Any]:
    """Scan receipts for store/day combinations whose Cancelled count exceeds
    the configured anomaly threshold — the operational-anomaly metric."""
    threshold = args.get("threshold")
    if threshold is None and settings is not None:
        threshold = settings.anomaly_threshold
    if threshold is None:
        threshold = 3
    threshold = int(threshold)

    date_from = args.get("date_from")
    date_to = args.get("date_to")

    clauses = ["r.status = 'Cancelled'"]
    params: dict[str, Any] = {"threshold": threshold}
    if date_from:
        clauses.append("r.date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        clauses.append("r.date <= :date_to")
        params["date_to"] = date_to
    where = " AND ".join(clauses)

    sql = f"""
        SELECT s.store_name, r.date, COUNT(*) AS cancelled_count
        FROM receipts r
        JOIN stores s ON s.id = r.store_id
        WHERE {where}
        GROUP BY s.store_name, r.date
        HAVING COUNT(*) >= :threshold
        ORDER BY cancelled_count DESC, s.store_name
    """
    with eng.connect() as conn:
        trans = conn.begin()
        try:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            rows = [
                {k: _json_safe(v) for k, v in row.items()}
                for row in conn.execute(text(sql), params).mappings().all()
            ]
        finally:
            trans.rollback()

    return {
        "threshold": threshold,
        "anomaly_count": len(rows),
        "anomalies": rows,
    }


# ---------------------------------------------------------------------------
# Anthropic tool definitions (schemas) and dispatch
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "run_readonly_sql",
        "description": (
            "Run a single read-only SQL SELECT against the POS database and "
            "return rows. Use for any ad-hoc analytics not covered by the other "
            "tools. Only SELECT/WITH is permitted; writes are rejected.\n\n"
            + SCHEMA_DESCRIPTION
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A single SQL SELECT statement (no semicolons).",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_sales_summary",
        "description": (
            "Aggregate sales for completed (Closed) receipts: receipt count, "
            "units, gross sales, net sales, and gross profit. Optionally filter "
            "by store name and/or an inclusive date range (YYYY-MM-DD)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "store_name": {"type": "string", "description": "e.g. 'COTERIE 1'"},
                "date_from": {"type": "string", "description": "YYYY-MM-DD inclusive"},
                "date_to": {"type": "string", "description": "YYYY-MM-DD inclusive"},
            },
        },
    },
    {
        "name": "scan_cancellation_anomalies",
        "description": (
            "Scan the receipts table for spikes in Cancelled transactions. "
            "Returns each store/day whose cancelled-receipt count meets or "
            "exceeds the anomaly threshold (defaults to the configured "
            "ai_settings.anomaly_threshold). Use this to surface operational "
            "anomalies."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "threshold": {
                    "type": "integer",
                    "description": "Override the configured anomaly threshold.",
                },
                "date_from": {"type": "string", "description": "YYYY-MM-DD inclusive"},
                "date_to": {"type": "string", "description": "YYYY-MM-DD inclusive"},
            },
        },
    },
]


def dispatch_tool(
    name: str,
    args: dict[str, Any],
    *,
    settings: AISettings | None = None,
) -> dict[str, Any]:
    """Execute a tool by name. Raises ToolError on unknown tool / bad input."""
    if name == "run_readonly_sql":
        return run_readonly_sql(args)
    if name == "get_sales_summary":
        return get_sales_summary(args)
    if name == "scan_cancellation_anomalies":
        return scan_cancellation_anomalies(args, settings=settings)
    raise ToolError(f"Unknown tool: {name}")
