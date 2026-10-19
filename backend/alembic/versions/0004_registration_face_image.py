"""add registration face image to students

Revision ID: dcf33c43f2d4
Revises: 41931231d9f2
Create Date: 2026-09-23 01:31:01.817737

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '41931231d9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('students', sa.Column('registration_face_image', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('students', 'registration_face_image')
