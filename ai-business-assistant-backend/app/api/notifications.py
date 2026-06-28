"""Notifications: list, mark-read, and trigger the stock-out scanner.

The frontend polls ``GET /api/notifications`` for near-real-time alerts. The
scanner (``POST /api/notifications/scan``) compares live stock against sales
velocity and records STOCKOUT_RISK notifications; it can be invoked by a
scheduled worker or on demand.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.ai_settings import get_or_create_settings
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.notification import STATUS_READ, STATUS_UNREAD, Notification
from app.models.user import User
from app.schemas.notification import NotificationList, NotificationOut, ScanResult
from app.services.data_source import get_pos_engine
from app.services.inventory import scan_and_record_stockouts

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("", response_model=NotificationList)
def list_notifications(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> NotificationList:
    stmt = select(Notification).order_by(Notification.created_at.desc()).limit(limit)
    if status_filter in (STATUS_UNREAD, STATUS_READ):
        stmt = stmt.where(Notification.status == status_filter)

    notifications = list(db.execute(stmt).scalars())
    unread_count = (
        db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.status == STATUS_UNREAD)
        ).scalar_one()
    )
    return NotificationList(
        unread_count=unread_count,
        notifications=[NotificationOut.model_validate(n) for n in notifications],
    )


@router.post("/scan", response_model=ScanResult)
def run_scan(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ScanResult:
    settings = get_or_create_settings(db)
    created = scan_and_record_stockouts(
        app_db=db, settings=settings, eng=get_pos_engine()
    )
    return ScanResult(
        created=len(created),
        notifications=[NotificationOut.model_validate(n) for n in created],
    )


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Notification:
    notif = db.get(Notification, notification_id)
    if notif is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
        )
    notif.status = STATUS_READ
    db.commit()
    db.refresh(notif)
    return notif


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, int]:
    result = (
        db.query(Notification)
        .filter(Notification.status == STATUS_UNREAD)
        .update({Notification.status: STATUS_READ})
    )
    db.commit()
    return {"updated": result}
