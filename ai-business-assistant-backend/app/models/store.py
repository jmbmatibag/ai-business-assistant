"""Physical stores / branches (e.g. COTERIE 1)."""

from typing import TYPE_CHECKING

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.receipt import Receipt


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)

    receipts: Mapped[list["Receipt"]] = relationship(back_populates="store")

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Store id={self.id} store_name={self.store_name!r}>"
