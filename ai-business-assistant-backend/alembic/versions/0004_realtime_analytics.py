"""real-time analytics: inventory_levels, notifications, daily_sales_summaries, data_source_connections

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- inventory_levels ---
    op.create_table(
        "inventory_levels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("item_name", sa.String(length=255), nullable=True),
        sa.Column("category", sa.String(length=128), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("store_id", "sku", name="uq_inventory_store_sku"),
    )
    op.create_index("ix_inventory_levels_store_id", "inventory_levels", ["store_id"])
    op.create_index("ix_inventory_levels_sku", "inventory_levels", ["sku"])
    op.create_index("ix_inventory_levels_category", "inventory_levels", ["category"])

    # --- notifications ---
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("store_id", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("suggested_prompt", sa.Text(), nullable=True),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="Unread"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_notifications_store_id", "notifications", ["store_id"])
    op.create_index("ix_notifications_type", "notifications", ["type"])

    # --- daily_sales_summaries ---
    op.create_table(
        "daily_sales_summaries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("summary_date", sa.Date(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=128), nullable=False, server_default=""),
        sa.Column(
            "total_quantity_sold", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "total_net_sales",
            sa.Numeric(precision=14, scale=2),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "total_cancelled_receipts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "total_gross_profit",
            sa.Numeric(precision=14, scale=2),
            nullable=False,
            server_default="0",
        ),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "summary_date",
            "store_id",
            "category",
            name="uq_daily_summary_dimensions",
        ),
    )
    op.create_index(
        "ix_daily_sales_summaries_summary_date",
        "daily_sales_summaries",
        ["summary_date"],
    )
    op.create_index(
        "ix_daily_sales_summaries_store_id", "daily_sales_summaries", ["store_id"]
    )

    # --- data_source_connections ---
    op.create_table(
        "data_source_connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("connection_name", sa.String(length=100), nullable=False),
        sa.Column(
            "db_dialect",
            sa.String(length=20),
            nullable=False,
            server_default="postgresql",
        ),
        sa.Column("db_host", sa.String(length=255), nullable=False),
        sa.Column("db_port", sa.Integer(), nullable=False, server_default="5432"),
        sa.Column("db_username", sa.String(length=100), nullable=False),
        sa.Column("db_password_encrypted", sa.Text(), nullable=False),
        sa.Column("db_name", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("data_source_connections")
    op.drop_index(
        "ix_daily_sales_summaries_store_id", table_name="daily_sales_summaries"
    )
    op.drop_index(
        "ix_daily_sales_summaries_summary_date", table_name="daily_sales_summaries"
    )
    op.drop_table("daily_sales_summaries")
    op.drop_index("ix_notifications_type", table_name="notifications")
    op.drop_index("ix_notifications_store_id", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("ix_inventory_levels_category", table_name="inventory_levels")
    op.drop_index("ix_inventory_levels_sku", table_name="inventory_levels")
    op.drop_index("ix_inventory_levels_store_id", table_name="inventory_levels")
    op.drop_table("inventory_levels")
