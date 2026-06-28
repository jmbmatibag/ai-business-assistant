"""Symmetric encryption for secrets stored in the application database.

External data-source passwords (``data_source_connections.db_password_encrypted``)
are encrypted with Fernet so a database leak does not directly expose the
credentials of every connected POS / branch database.

The key comes from ``settings.fernet_key``. In development, if no key is set we
derive a stable key from ``jwt_secret_key`` so the app still runs out of the box
— production deployments MUST set an explicit ``FERNET_KEY``.
"""

from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


class DecryptionError(Exception):
    """Raised when a stored secret cannot be decrypted (wrong/rotated key)."""


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = settings.fernet_key.strip()
    if key:
        return Fernet(key.encode())
    # Dev fallback: derive a valid 32-byte urlsafe key from the JWT secret.
    digest = hashlib.sha256(settings.jwt_secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a plaintext secret, returning a urlsafe token string."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    """Decrypt a token produced by :func:`encrypt_secret`."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise DecryptionError(
            "Could not decrypt stored credential; the FERNET_KEY may have changed."
        ) from exc
