import secrets
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Integer, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


def gen_exam_code() -> str:
    return f"EXAM-{secrets.token_hex(3).upper()}"


DEFAULT_SECURITY = {
    "camera": True,
    "microphone": True,
    "screenShare": True,
    "identity": True,
    "liveness": True,
}


class ExamSession(Base):
    __tablename__ = "exam_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, default=gen_exam_code)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    total_marks: Mapped[int] = mapped_column(Integer, default=100)
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduled_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # draft | published | active | completed
    status: Mapped[str] = mapped_column(String(20), default="draft")
    security: Mapped[dict] = mapped_column(JSON, default=lambda: dict(DEFAULT_SECURITY))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    course: Mapped["Course"] = relationship(back_populates="exams")
    questions: Mapped[list["Question"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", order_by="Question.order"
    )
    attempts: Mapped[list["ExamAttempt"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan"
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exam_sessions.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(20))  
    text: Mapped[str] = mapped_column(Text)
    options: Mapped[list | None] = mapped_column(JSON, nullable=True)  
    correct_answer: Mapped[str | None] = mapped_column(Text, nullable=True)  
    marks: Mapped[int] = mapped_column(Integer, default=1)
    order: Mapped[int] = mapped_column(Integer, default=0)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)     
    answer_key: Mapped[dict | None] = mapped_column(JSON, nullable=True)   
    image_url: Mapped[str | None] = mapped_column(String(300), nullable=True)

    exam: Mapped["ExamSession"] = relationship(back_populates="questions")