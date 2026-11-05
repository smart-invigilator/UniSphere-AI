import secrets
import string
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Integer, Text, ForeignKey, JSON, Boolean, UniqueConstraint, Index, false
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base

_CODE_ALPHABET = string.ascii_lowercase


def gen_meeting_code() -> str:
    parts = ["".join(secrets.choice(_CODE_ALPHABET) for _ in range(n)) for n in (3, 4, 3)]
    return "-".join(parts)


def gen_room_name() -> str:
    return f"lc-{secrets.token_hex(12)}"


DEFAULT_LIVE_SETTINGS = {
    "chat_enabled": True,
    "locked": False,
    "allow_student_mic": True,
    "allow_student_camera": True,
    "allow_student_screen": False,
    "spotlight": None,
    "grants": {},
    "removed": [],
}


class LiveClass(Base):
    __tablename__ = "live_classes"
    __table_args__ = (
        Index("ix_live_classes_course_status", "course_id", "status"),
        Index("ix_live_classes_status_start", "status", "scheduled_start"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    room_name: Mapped[str] = mapped_column(String(64), unique=True, default=gen_room_name)
    meeting_code: Mapped[str] = mapped_column(String(16), unique=True, index=True, default=gen_meeting_code)
    status: Mapped[str] = mapped_column(String(16), default="scheduled")
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    settings: Mapped[dict] = mapped_column(JSON, default=lambda: dict(DEFAULT_LIVE_SETTINGS))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    course: Mapped["Course"] = relationship()
    teacher: Mapped["User"] = relationship()
    attendance: Mapped[list["LiveClassAttendance"]] = relationship(back_populates="live_class", cascade="all, delete-orphan")


class LiveClassAttendance(Base):
    __tablename__ = "live_class_attendance"
    __table_args__ = (UniqueConstraint("live_class_id", "user_id", name="uq_live_attendance_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    live_class_id: Mapped[int] = mapped_column(ForeignKey("live_classes.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="student")
    first_joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_seconds: Mapped[int] = mapped_column(Integer, default=0)
    join_count: Mapped[int] = mapped_column(Integer, default=1)
    is_connected: Mapped[bool] = mapped_column(Boolean, default=True, server_default=false())

    live_class: Mapped["LiveClass"] = relationship(back_populates="attendance")
    user: Mapped["User"] = relationship()


class LiveClassMessage(Base):
    __tablename__ = "live_class_messages"
    __table_args__ = (Index("ix_live_messages_class_created", "live_class_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    live_class_id: Mapped[int] = mapped_column(ForeignKey("live_classes.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16), default="chat")
    text: Mapped[str] = mapped_column(Text)
    answered: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user: Mapped["User"] = relationship()