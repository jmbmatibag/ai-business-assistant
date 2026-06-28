"""Multi-period analytics + dashboard headline metrics.

Both endpoints accept a ``source`` query parameter (``database`` | ``csv``) so the
frontend's Live POS / Local CSV toggle routes reads to the right engine without a
page reload.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.analytics import dashboard_metrics, trends
from app.services.data_source import EphemeralDataMissing, resolve_read_engine
from app.services.ephemeral import get_ephemeral_engine

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

_ALLOWED = {"monthly", "quarterly", "semi-annual", "annual"}


@router.get("/trends")
def get_trends(
    period: str = Query(default="monthly"),
    store_id: int | None = Query(default=None),
    source: str = Query(default="database"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if period not in _ALLOWED:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"period must be one of: {', '.join(sorted(_ALLOWED))}",
        )

    if (source or "database").lower() == "csv":
        eng = get_ephemeral_engine(user.id)
        if eng is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No CSV data uploaded for this session.",
            )
        # The summary analytics read through an ORM Session; bind one to the
        # ephemeral engine so the same query runs against the uploaded data.
        with Session(bind=eng) as csv_db:
            return trends(csv_db, period=period, store_id=store_id)

    return trends(db, period=period, store_id=store_id)


@router.get("/dashboard")
def get_dashboard(
    source: str = Query(default="database"),
    _: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    try:
        eng = resolve_read_engine(source, user.id)
    except EphemeralDataMissing as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        )
    return dashboard_metrics(eng)
