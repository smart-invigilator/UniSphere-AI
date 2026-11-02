"""advanced question types, question media, manual grading flag

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('questions', sa.Column('settings', sa.JSON(), nullable=True))
    op.add_column('questions', sa.Column('media', sa.JSON(), nullable=True))
    op.add_column('questions', sa.Column('answer_key', sa.JSON(), nullable=True))
    op.add_column(
        'answers',
        sa.Column('requires_manual', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        "UPDATE answers SET requires_manual = TRUE "
        "WHERE question_id IN (SELECT id FROM questions WHERE type = 'short')"
    )
    op.create_index('ix_answers_attempt_requires_manual', 'answers', ['attempt_id', 'requires_manual'])


def downgrade() -> None:
    op.drop_index('ix_answers_attempt_requires_manual', table_name='answers')
    op.drop_column('answers', 'requires_manual')
    op.drop_column('questions', 'answer_key')
    op.drop_column('questions', 'media')
    op.drop_column('questions', 'settings')