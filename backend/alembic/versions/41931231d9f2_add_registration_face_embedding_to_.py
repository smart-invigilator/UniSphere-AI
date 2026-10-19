"""add registration_face_embedding to students

Revision ID: 41931231d9f2
Revises: 0002
Create Date: 2026-09-02 16:50:34.584927

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '41931231d9f2'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('students', sa.Column('registration_face_embedding', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('students', 'registration_face_embedding')
