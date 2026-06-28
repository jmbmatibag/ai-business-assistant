"""Manage external POS data-source connections from the settings UI.

Passwords are Fernet-encrypted before storage and never returned. Activating a
connection (``is_active``) deactivates the others, so exactly one external target
is live at a time; the routing layer then points all live POS reads at it.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.crypto import encrypt_secret
from app.db.session import get_db
from app.models.data_source import DataSourceConnection
from app.models.user import User
from app.schemas.data_source import (
    ALLOWED_DIALECTS,
    ConnectionStatusOut,
    ConnectionTestResult,
    DataSourceCreate,
    DataSourceOut,
    DataSourceUpdate,
)
from app.services.data_source import (
    get_pos_engine,
    invalidate_engine_cache,
    test_connection,
)

router = APIRouter(prefix="/api/data-sources", tags=["data-sources"])


def _validate_dialect(dialect: str) -> None:
    if dialect not in ALLOWED_DIALECTS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"db_dialect must be one of: {', '.join(ALLOWED_DIALECTS)}",
        )


def _get_or_404(db: Session, connection_id: int) -> DataSourceConnection:
    conn = db.get(DataSourceConnection, connection_id)
    if conn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found"
        )
    return conn


def _deactivate_others(db: Session, keep_id: int | None) -> None:
    stmt = update(DataSourceConnection).values(is_active=False)
    if keep_id is not None:
        stmt = stmt.where(DataSourceConnection.id != keep_id)
    db.execute(stmt)


@router.get("", response_model=list[DataSourceOut])
def list_connections(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[DataSourceConnection]:
    return list(
        db.execute(
            select(DataSourceConnection).order_by(DataSourceConnection.id.desc())
        ).scalars()
    )


@router.get("/status", response_model=ConnectionStatusOut)
def connection_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ConnectionStatusOut:
    """Probe the live POS database the app currently reads from.

    Returns ``connected`` after a successful ``SELECT 1``, or ``error`` with the
    raw driver message so the settings UI can surface it verbatim.
    """
    from sqlalchemy import text

    active = (
        db.execute(
            select(DataSourceConnection)
            .where(DataSourceConnection.is_active.is_(True))
            .order_by(DataSourceConnection.id.desc())
        )
        .scalars()
        .first()
    )
    target = active.connection_name if active else "Built-in database"

    try:
        eng = get_pos_engine()
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return ConnectionStatusOut(
            status="connected",
            detail=f"Live reads are routed to “{target}”.",
            target=target,
        )
    except Exception as exc:  # noqa: BLE001 - surface any driver/network error
        return ConnectionStatusOut(status="error", detail=str(exc), target=target)


@router.post("", response_model=DataSourceOut, status_code=status.HTTP_201_CREATED)
def create_connection(
    payload: DataSourceCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DataSourceConnection:
    _validate_dialect(payload.db_dialect)
    conn = DataSourceConnection(
        connection_name=payload.connection_name,
        db_dialect=payload.db_dialect,
        db_host=payload.db_host,
        db_port=payload.db_port,
        db_username=payload.db_username,
        db_password_encrypted=encrypt_secret(payload.db_password),
        db_name=payload.db_name,
        is_active=payload.is_active,
    )
    db.add(conn)
    db.flush()
    if payload.is_active:
        _deactivate_others(db, keep_id=conn.id)
    db.commit()
    db.refresh(conn)
    invalidate_engine_cache()
    return conn


@router.put("/{connection_id}", response_model=DataSourceOut)
def update_connection(
    connection_id: int,
    payload: DataSourceUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DataSourceConnection:
    conn = _get_or_404(db, connection_id)
    data = payload.model_dump(exclude_unset=True)

    if "db_dialect" in data:
        _validate_dialect(data["db_dialect"])
    if "db_password" in data:
        conn.db_password_encrypted = encrypt_secret(data.pop("db_password"))

    for field, value in data.items():
        setattr(conn, field, value)

    if data.get("is_active"):
        _deactivate_others(db, keep_id=conn.id)

    db.commit()
    db.refresh(conn)
    invalidate_engine_cache()
    return conn


@router.post("/{connection_id}/activate", response_model=DataSourceOut)
def activate_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DataSourceConnection:
    conn = _get_or_404(db, connection_id)
    conn.is_active = True
    _deactivate_others(db, keep_id=conn.id)
    db.commit()
    db.refresh(conn)
    invalidate_engine_cache()
    return conn


@router.post("/{connection_id}/test", response_model=ConnectionTestResult)
def test_connection_endpoint(
    connection_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ConnectionTestResult:
    conn = _get_or_404(db, connection_id)
    ok, message = test_connection(conn)
    return ConnectionTestResult(ok=ok, message=message)


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    conn = _get_or_404(db, connection_id)
    db.delete(conn)
    db.commit()
    invalidate_engine_cache(connection_id)
