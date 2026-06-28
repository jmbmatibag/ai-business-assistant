"""Dynamic connection-string routing for the live POS data target.

The app no longer hard-codes a single POS database. Operators register external
connections in ``data_source_connections`` and mark one active; everything that
reads "live" POS data (the Claude SQL/replenishment tools, the inventory
scanner, the analytics endpoints) resolves its engine through here.

When no active external connection is configured, we fall back to the
application's own engine — in development the seeded POS data lives there, so the
whole stack works out of the box.
"""

from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine

from app.core.crypto import decrypt_secret
from app.db.session import SessionLocal, engine as default_engine
from app.models.data_source import DataSourceConnection
from app.services.ephemeral import get_ephemeral_engine

# Cache external engines by connection id so we don't rebuild a pool per request.
_engine_cache: dict[int, Engine] = {}

# SQLAlchemy driver per supported dialect.
_DRIVERS = {
    "postgresql": "postgresql+psycopg2",
    "mysql": "mysql+pymysql",
}


def _build_url(conn: DataSourceConnection) -> str:
    driver = _DRIVERS.get(conn.db_dialect.lower(), conn.db_dialect)
    password = decrypt_secret(conn.db_password_encrypted)
    return (
        f"{driver}://{conn.db_username}:{password}"
        f"@{conn.db_host}:{conn.db_port}/{conn.db_name}"
    )


def _active_connection() -> DataSourceConnection | None:
    """Return the most-recent active external connection, if any."""
    with SessionLocal() as db:
        return (
            db.execute(
                select(DataSourceConnection)
                .where(DataSourceConnection.is_active.is_(True))
                .order_by(DataSourceConnection.id.desc())
            )
            .scalars()
            .first()
        )


def get_pos_engine() -> Engine:
    """Resolve the SQLAlchemy engine pointed at the live POS data target."""
    conn = _active_connection()
    if conn is None:
        return default_engine

    cached = _engine_cache.get(conn.id)
    if cached is not None:
        return cached

    eng = create_engine(_build_url(conn), pool_pre_ping=True, future=True)
    _engine_cache[conn.id] = eng
    return eng


class EphemeralDataMissing(Exception):
    """Raised when a request asks for Local CSV data but none has been uploaded."""


def resolve_read_engine(source: str | None, user_id: int) -> Engine:
    """Pick the engine for a read, given the requested data source.

    - ``"csv"``      -> the caller's ephemeral in-memory SQLite engine.
    - anything else  -> the live POS engine (active external connection or the
      app's own database in development).
    """
    if (source or "database").lower() == "csv":
        eng = get_ephemeral_engine(user_id)
        if eng is None:
            raise EphemeralDataMissing(
                "No CSV data has been uploaded for this session. Switch to Local "
                "CSV mode and upload one or more files first."
            )
        return eng
    return get_pos_engine()


def invalidate_engine_cache(connection_id: int | None = None) -> None:
    """Drop cached engines (call after a connection is edited/deactivated)."""
    if connection_id is None:
        for eng in _engine_cache.values():
            eng.dispose()
        _engine_cache.clear()
        return
    eng = _engine_cache.pop(connection_id, None)
    if eng is not None:
        eng.dispose()


def test_connection(conn: DataSourceConnection) -> tuple[bool, str]:
    """Attempt a trivial query against a connection. Returns (ok, message)."""
    from sqlalchemy import text

    try:
        eng = create_engine(_build_url(conn), pool_pre_ping=True, future=True)
        with eng.connect() as c:
            c.execute(text("SELECT 1"))
        eng.dispose()
        return True, "Connection succeeded."
    except Exception as exc:  # noqa: BLE001 - surface any driver/network error
        return False, str(exc)
