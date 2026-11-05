"""live classes, attendance and chat

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'live_classes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('course_id', sa.Integer(), sa.ForeignKey('courses.id', ondelete='CASCADE'), nullable=False),
        sa.Column('teacher_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(160), nullable=False),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('room_name', sa.String(64), nullable=False, unique=True),
        sa.Column('meeting_code', sa.String(16), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='scheduled'),
        sa.Column('scheduled_start', sa.DateTime(timezone=True), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('settings', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_live_classes_course_id', 'live_classes', ['course_id'])
    op.create_index('ix_live_classes_teacher_id', 'live_classes', ['teacher_id'])
    op.create_index('ix_live_classes_meeting_code', 'live_classes', ['meeting_code'], unique=True)
    op.create_index('ix_live_classes_course_status', 'live_classes', ['course_id', 'status'])
    op.create_index('ix_live_classes_status_start', 'live_classes', ['status', 'scheduled_start'])

    op.create_table(
        'live_class_attendance',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('live_class_id', sa.Integer(), sa.ForeignKey('live_classes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(16), nullable=False, server_default='student'),
        sa.Column('first_joined_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_joined_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_left_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('total_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('join_count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('is_connected', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint('live_class_id', 'user_id', name='uq_live_attendance_user'),
    )
    op.create_index('ix_live_class_attendance_live_class_id', 'live_class_attendance', ['live_class_id'])
    op.create_index('ix_live_class_attendance_user_id', 'live_class_attendance', ['user_id'])

    op.create_table(
        'live_class_messages',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('live_class_id', sa.Integer(), sa.ForeignKey('live_classes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(16), nullable=False, server_default='chat'),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('answered', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('hidden', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_live_messages_class_created', 'live_class_messages', ['live_class_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_live_messages_class_created', table_name='live_class_messages')
    op.drop_table('live_class_messages')
    op.drop_index('ix_live_class_attendance_user_id', table_name='live_class_attendance')
    op.drop_index('ix_live_class_attendance_live_class_id', table_name='live_class_attendance')
    op.drop_table('live_class_attendance')
    op.drop_index('ix_live_classes_status_start', table_name='live_classes')
    op.drop_index('ix_live_classes_course_status', table_name='live_classes')
    op.drop_index('ix_live_classes_meeting_code', table_name='live_classes')
    op.drop_index('ix_live_classes_teacher_id', table_name='live_classes')
    op.drop_index('ix_live_classes_course_id', table_name='live_classes')
    op.drop_table('live_classes')