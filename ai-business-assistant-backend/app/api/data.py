"""Ephemeral data endpoints for Local CSV mode.

Uploaded CSVs are parsed into a private in-memory SQLite engine (see
``app.services.ephemeral``) and are **never** persisted to PostgreSQL. The data
lives only for the duration of the session and can be flushed at any time.
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.deps import get_current_user
from app.models.user import User
from app.services.ephemeral import (
    clear_ephemeral,
    get_ephemeral_status,
    load_csv_files,
)

router = APIRouter(prefix="/api/data", tags=["data"])

# Guardrails for ad-hoc uploads.
_MAX_FILES = 20
_MAX_TOTAL_BYTES = 50 * 1024 * 1024  # 50 MB across all files


@router.post("/upload-ephemeral")
async def upload_ephemeral(
    files: list[UploadFile] = File(...),
    user: User = Depends(get_current_user),
) -> dict:
    """Load one or more CSV exports into the caller's in-memory engine.

    Replaces any data previously uploaded in this session.
    """
    if not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Attach at least one CSV file.",
        )
    if len(files) > _MAX_FILES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Too many files (max {_MAX_FILES}).",
        )

    payload: list[tuple[str, bytes]] = []
    total = 0
    for f in files:
        blob = await f.read()
        total += len(blob)
        if total > _MAX_TOTAL_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Upload exceeds the 50 MB total limit.",
            )
        payload.append((f.filename or "upload.csv", blob))

    try:
        stats = load_csv_files(user.id, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )

    return {"loaded": True, **stats}


@router.get("/ephemeral-status")
def ephemeral_status(user: User = Depends(get_current_user)) -> dict:
    """Report whether the caller has ephemeral CSV data loaded, plus a summary."""
    stats = get_ephemeral_status(user.id)
    if stats is None:
        return {"loaded": False}
    return {"loaded": True, **stats}


@router.post("/clear-ephemeral", status_code=status.HTTP_200_OK)
def clear_ephemeral_data(user: User = Depends(get_current_user)) -> dict:
    """Flush the caller's ephemeral CSV data from memory."""
    cleared = clear_ephemeral(user.id)
    return {"cleared": cleared}
