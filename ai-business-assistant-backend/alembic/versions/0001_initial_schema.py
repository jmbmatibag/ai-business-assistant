"""initial schema: users, stores, receipts, sales_items

Revision ID: 0001
Revises:
Create Date: 2026-06-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(length=150), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False, server_default="user"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "stores",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("store_name", sa.String(length=150), nullable=False),
        sa.UniqueConstraint("store_name", name="uq_stores_store_name"),
    )
    op.create_index("ix_stores_store_name", "stores", ["store_name"], unique=True)

    op.create_table(
        "receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("receipt_number", sa.String(length=64), nullable=False),
        sa.Column("receipt_type", sa.String(length=64), nullable=True),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["store_id"], ["stores.id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint("receipt_number", name="uq_receipts_receipt_number"),
    )
    op.create_index(
        "ix_receipts_receipt_number", "receipts", ["receipt_number"], unique=True
    )
    op.create_index("ix_receipts_date", "receipts", ["date"])
    op.create_index("ix_receipts_status", "receipts", ["status"])
    op.create_index("ix_receipts_store_id", "receipts", ["store_id"])

    op.create_table(
        "sales_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("receipt_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=128), nullable=True),
        sa.Column("sku", sa.String(length=64), nullable=True),
        sa.Column("item_name", sa.String(length=255), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("gross_sales", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("net_sales", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.Column("gross_profit", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["receipt_id"], ["receipts.id"], ondelete="CASCADE"
        ),
    )
    op.create_index("ix_sales_items_receipt_id", "sales_items", ["receipt_id"])
    op.create_index("ix_sales_items_category", "sales_items", ["category"])
    op.create_index("ix_sales_items_sku", "sales_items", ["sku"])


def downgrade() -> None:
    op.drop_table("sales_items")
    op.drop_table("receipts")
    op.drop_index("ix_stores_store_name", table_name="stores")
    op.drop_table("stores")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
