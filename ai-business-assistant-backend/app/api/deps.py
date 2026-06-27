"""Shared FastAPI dependencies (auth, etc.)."""

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=True)

_credentials_error = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the authenticated user from a Bearer JWT, or raise 401."""
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise _credentials_error

    subject = payload.get("sub")
    if subject is None:
        raise _credentials_error

    try:
        user_id = int(subject)
    except (TypeError, ValueError):
        raise _credentials_error

    user = db.get(User, user_id)
    if user is None:
        raise _credentials_error
    return user
