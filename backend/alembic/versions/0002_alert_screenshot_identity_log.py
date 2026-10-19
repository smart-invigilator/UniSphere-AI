"""add alert screenshot and identity check log

Revision ID: 92c7a9d92def
Revises: 0001
Create Date: 2026-08-25 19:28:09.039208

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('identity_check_logs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('attempt_id', sa.Integer(), nullable=False),
    sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
    sa.Column('similarity', sa.Float(), nullable=False),
    sa.Column('is_match', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['attempt_id'], ['exam_attempts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_identity_check_logs_attempt_id'), 'identity_check_logs', ['attempt_id'], unique=False)
    op.create_index(op.f('ix_identity_check_logs_timestamp'), 'identity_check_logs', ['timestamp'], unique=False)
    op.add_column('alerts', sa.Column('screenshot', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('alerts', 'screenshot')
    op.drop_index(op.f('ix_identity_check_logs_timestamp'), table_name='identity_check_logs')
    op.drop_index(op.f('ix_identity_check_logs_attempt_id'), table_name='identity_check_logs')
    op.drop_table('identity_check_logs')
