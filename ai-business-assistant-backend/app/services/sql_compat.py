"""Small cross-dialect helpers so the read paths work against both the live
PostgreSQL POS database and the ephemeral in-memory SQLite engine used in
Local CSV mode.

The read tools defend against accidental writes with a ``SET TRANSACTION READ
ONLY`` statement wrapped in an always-rolled-back transaction. That statement is
PostgreSQL-specific; SQLite neither supports nor needs it (the rollback already
guarantees nothing is persisted), so we issue it only when the dialect is
PostgreSQL.
"""

from __future__ import annotations

from sqlalchemy.engine import Connection
from sqlalchemy import text


def _set_read_only(conn: Connection) -> None:
    """Best-effort read-only guard for the current transaction.

    No-op on dialects that don't support (or need) it — the surrounding
    ``trans.rollback()`` is what actually prevents persistence.
    """
    if conn.dialect.name == "postgresql":
        conn.execute(text("SET TRANSACTION READ ONLY"))
