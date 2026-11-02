"""answer autosave ordering and revision tracking

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('answers', sa.Column('client_seq', sa.BigInteger(), nullable=False, server_default=sa.text('0')))
    op.add_column('answers', sa.Column('revision', sa.Integer(), nullable=False, server_default=sa.text('0')))


def downgrade() -> None:
    op.drop_column('answers', 'revision')
    op.drop_column('answers', 'client_seq')