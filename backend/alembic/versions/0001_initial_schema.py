"""initial schema

Revision ID: 4b75df94e38c
Revises: 
Create Date: 2026-08-22 11:29:15.431906

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('sessions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
    sa.Column('end_time', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password', sa.String(length=255), nullable=False),
    sa.Column('role', sa.Enum('admin', 'teacher', 'student', name='role'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_table('courses',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('teacher_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('subject', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_courses_code'), 'courses', ['code'], unique=True)
    op.create_index(op.f('ix_courses_teacher_id'), 'courses', ['teacher_id'], unique=False)
    op.create_table('students',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.String(length=40), nullable=False),
    sa.Column('department', sa.String(length=120), nullable=False),
    sa.Column('session_label', sa.String(length=40), nullable=False),
    sa.Column('attendance', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_index(op.f('ix_students_student_id'), 'students', ['student_id'], unique=True)
    op.create_table('enrollments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('course_id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('method', sa.String(length=20), nullable=False),
    sa.Column('enrolled_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('course_id', 'student_id', name='uq_course_student')
    )
    op.create_index(op.f('ix_enrollments_course_id'), 'enrollments', ['course_id'], unique=False)
    op.create_index(op.f('ix_enrollments_student_id'), 'enrollments', ['student_id'], unique=False)
    op.create_table('exam_sessions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('course_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('code', sa.String(length=20), nullable=False),
    sa.Column('duration_minutes', sa.Integer(), nullable=False),
    sa.Column('total_marks', sa.Integer(), nullable=False),
    sa.Column('scheduled_start', sa.DateTime(timezone=True), nullable=True),
    sa.Column('scheduled_end', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('security', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_exam_sessions_code'), 'exam_sessions', ['code'], unique=True)
    op.create_index(op.f('ix_exam_sessions_course_id'), 'exam_sessions', ['course_id'], unique=False)
    op.create_table('exam_attempts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('exam_id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('auto_score', sa.Float(), nullable=False),
    sa.Column('manual_score', sa.Float(), nullable=False),
    sa.Column('final_score', sa.Float(), nullable=True),
    sa.Column('camera_ok', sa.Boolean(), nullable=False),
    sa.Column('microphone_ok', sa.Boolean(), nullable=False),
    sa.Column('screen_ok', sa.Boolean(), nullable=False),
    sa.Column('liveness_ok', sa.Boolean(), nullable=False),
    sa.Column('identity_verified', sa.Boolean(), nullable=False),
    sa.Column('reference_embedding', sa.JSON(), nullable=True),
    sa.Column('last_face_similarity', sa.Float(), nullable=True),
    sa.Column('identity_mismatch_streak', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['exam_id'], ['exam_sessions.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('exam_id', 'student_id', name='uq_exam_student_attempt')
    )
    op.create_index(op.f('ix_exam_attempts_exam_id'), 'exam_attempts', ['exam_id'], unique=False)
    op.create_index(op.f('ix_exam_attempts_student_id'), 'exam_attempts', ['student_id'], unique=False)
    op.create_table('questions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('exam_id', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('options', sa.JSON(), nullable=True),
    sa.Column('correct_answer', sa.Text(), nullable=True),
    sa.Column('marks', sa.Integer(), nullable=False),
    sa.Column('order', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['exam_id'], ['exam_sessions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_questions_exam_id'), 'questions', ['exam_id'], unique=False)
    op.create_table('alerts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('attempt_id', sa.Integer(), nullable=True),
    sa.Column('alert_type', sa.String(length=80), nullable=False),
    sa.Column('severity', sa.String(length=20), nullable=False),
    sa.Column('confidence', sa.Float(), nullable=False),
    sa.Column('reviewed', sa.Boolean(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['attempt_id'], ['exam_attempts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_alerts_attempt_id'), 'alerts', ['attempt_id'], unique=False)
    op.create_index(op.f('ix_alerts_student_id'), 'alerts', ['student_id'], unique=False)
    op.create_index(op.f('ix_alerts_timestamp'), 'alerts', ['timestamp'], unique=False)
    op.create_table('answers',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('attempt_id', sa.Integer(), nullable=False),
    sa.Column('question_id', sa.Integer(), nullable=False),
    sa.Column('response', sa.Text(), nullable=False),
    sa.Column('is_correct', sa.Boolean(), nullable=True),
    sa.Column('marks_awarded', sa.Float(), nullable=False),
    sa.Column('graded_by', sa.Integer(), nullable=True),
    sa.Column('graded_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('feedback', sa.Text(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['attempt_id'], ['exam_attempts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['graded_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('attempt_id', 'question_id', name='uq_attempt_question')
    )
    op.create_index(op.f('ix_answers_attempt_id'), 'answers', ['attempt_id'], unique=False)
    op.create_index(op.f('ix_answers_question_id'), 'answers', ['question_id'], unique=False)
    op.create_table('attention_scores',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('attempt_id', sa.Integer(), nullable=True),
    sa.Column('score', sa.Float(), nullable=False),
    sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['attempt_id'], ['exam_attempts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_attention_scores_attempt_id'), 'attention_scores', ['attempt_id'], unique=False)
    op.create_index(op.f('ix_attention_scores_student_id'), 'attention_scores', ['student_id'], unique=False)
    op.create_index(op.f('ix_attention_scores_timestamp'), 'attention_scores', ['timestamp'], unique=False)
    op.create_table('monitoring_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('student_id', sa.Integer(), nullable=False),
    sa.Column('attempt_id', sa.Integer(), nullable=True),
    sa.Column('event_type', sa.String(length=80), nullable=False),
    sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['attempt_id'], ['exam_attempts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_monitoring_events_attempt_id'), 'monitoring_events', ['attempt_id'], unique=False)
    op.create_index(op.f('ix_monitoring_events_student_id'), 'monitoring_events', ['student_id'], unique=False)
    op.create_index(op.f('ix_monitoring_events_timestamp'), 'monitoring_events', ['timestamp'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_monitoring_events_timestamp'), table_name='monitoring_events')
    op.drop_index(op.f('ix_monitoring_events_student_id'), table_name='monitoring_events')
    op.drop_index(op.f('ix_monitoring_events_attempt_id'), table_name='monitoring_events')
    op.drop_table('monitoring_events')
    op.drop_index(op.f('ix_attention_scores_timestamp'), table_name='attention_scores')
    op.drop_index(op.f('ix_attention_scores_student_id'), table_name='attention_scores')
    op.drop_index(op.f('ix_attention_scores_attempt_id'), table_name='attention_scores')
    op.drop_table('attention_scores')
    op.drop_index(op.f('ix_answers_question_id'), table_name='answers')
    op.drop_index(op.f('ix_answers_attempt_id'), table_name='answers')
    op.drop_table('answers')
    op.drop_index(op.f('ix_alerts_timestamp'), table_name='alerts')
    op.drop_index(op.f('ix_alerts_student_id'), table_name='alerts')
    op.drop_index(op.f('ix_alerts_attempt_id'), table_name='alerts')
    op.drop_table('alerts')
    op.drop_index(op.f('ix_questions_exam_id'), table_name='questions')
    op.drop_table('questions')
    op.drop_index(op.f('ix_exam_attempts_student_id'), table_name='exam_attempts')
    op.drop_index(op.f('ix_exam_attempts_exam_id'), table_name='exam_attempts')
    op.drop_table('exam_attempts')
    op.drop_index(op.f('ix_exam_sessions_course_id'), table_name='exam_sessions')
    op.drop_index(op.f('ix_exam_sessions_code'), table_name='exam_sessions')
    op.drop_table('exam_sessions')
    op.drop_index(op.f('ix_enrollments_student_id'), table_name='enrollments')
    op.drop_index(op.f('ix_enrollments_course_id'), table_name='enrollments')
    op.drop_table('enrollments')
    op.drop_index(op.f('ix_students_student_id'), table_name='students')
    op.drop_table('students')
    op.drop_index(op.f('ix_courses_teacher_id'), table_name='courses')
    op.drop_index(op.f('ix_courses_code'), table_name='courses')
    op.drop_table('courses')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_table('sessions')
