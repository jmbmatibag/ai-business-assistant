"""Dynamic external data-source connections.

To future-proof the app for multi-store scaling, different franchises, or
separate database migrations, the backend does not hard-code a single POS
connection. Operators register external databases here (via the settings UI) and
mark one active; the connection-routing layer points live queries at it.

The password is stored Fernet-encrypted (``db_password_encrypted``); it is never
returned to clients in plaintext.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DataSourceConnection(Base):
    __tablename__ = "data_source_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connection_name: Mapped[str] = mapped_column(String(100), nullable=False)
    db_dialect: Mapped[str] = mapped_column(
        String(20), nullable=False, default="postgresql", server_default="postgresql"
    )
    db_host: Mapped[str] = mapped_column(String(255), nullable=False)
    db_port: Mapped[int] = mapped_column(
        Integer, nullable=False, default=5432, server_default="5432"
    )
    db_username: Mapped[str] = mapped_column(String(100), nullable=False)
    # Fernet-encrypted password token.
    db_password_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    db_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<DataSourceConnection id={self.id} name={self.connection_name!r} "
            f"active={self.is_active}>"
        )
