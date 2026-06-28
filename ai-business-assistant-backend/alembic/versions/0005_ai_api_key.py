"""add encrypted Anthropic API key to ai_settings

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ai_settings",
        sa.Column("anthropic_api_key_encrypted", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_settings", "anthropic_api_key_encrypted")
