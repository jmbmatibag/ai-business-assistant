"""Declarative base and model registry.

Importing this module ensures every model is registered on ``Base.metadata``,
which Alembic autogenerate and ``create_all`` rely on.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Import models so they attach to Base.metadata. Keep at the bottom to avoid
# circular imports (models import Base from this module).
from app.models import (  # noqa: E402,F401
    user,
    store,
    receipt,
    sales_item,
    ai_settings,
    conversation,
    inventory,
    notification,
    daily_sales_summary,
    data_source,
    ml_analytics,
)
