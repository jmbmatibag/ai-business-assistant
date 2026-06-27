"""ai_settings table

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "current_model",
            sa.String(length=64),
            nullable=False,
            server_default="claude-opus-4-8",
        ),
        sa.Column("base_system_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "default_safety_stock", sa.Integer(), nullable=False, server_default="20"
        ),
        sa.Column(
            "anomaly_threshold", sa.Integer(), nullable=False, server_default="3"
        ),
    )


def downgrade() -> None:
    op.drop_table("ai_settings")
