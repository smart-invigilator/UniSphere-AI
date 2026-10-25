"""360-degree face scan templates on students

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-25
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("students", sa.Column("face_scan_templates", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("students", "face_scan_templates")
