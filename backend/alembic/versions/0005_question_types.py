"""extra question types: config, answer_key, image_url on questions

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("questions", sa.Column("config", sa.JSON(), nullable=True))
    op.add_column("questions", sa.Column("answer_key", sa.JSON(), nullable=True))
    op.add_column("questions", sa.Column("image_url", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("questions", "image_url")
    op.drop_column("questions", "answer_key")
    op.drop_column("questions", "config")
