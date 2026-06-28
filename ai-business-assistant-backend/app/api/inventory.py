"""Inventory read endpoints (live low-stock view for the dashboard)."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.inventory import LowStockItem, LowStockResponse
from app.services.data_source import EphemeralDataMissing, resolve_read_engine
from app.services.inventory import DEFAULT_REORDER_DAYS, find_low_stock

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("/low-stock", response_model=LowStockResponse)
def low_stock(
    reorder_days: int = Query(default=DEFAULT_REORDER_DAYS, ge=1, le=30),
    store_id: int | None = Query(default=None),
    source: str = Query(default="database"),
    user: User = Depends(get_current_user),
    __: Session = Depends(get_db),
) -> LowStockResponse:
    try:
        eng = resolve_read_engine(source, user.id)
    except EphemeralDataMissing as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    items = find_low_stock(eng=eng, store_id=store_id, reorder_days=reorder_days)
    return LowStockResponse(
        reorder_days=reorder_days,
        count=len(items),
        items=[LowStockItem(**i) for i in items],
    )
