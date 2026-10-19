from datetime import datetime, timezone
from sqlalchemy import DateTime, Float, Boolean, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id", name="uq_attempt_question"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("exam_attempts.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)

    response: Mapped[str] = mapped_column(Text, default="")
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    marks_awarded: Mapped[float] = mapped_column(Float, default=0.0)

    graded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    feedback: Mapped[str] = mapped_column(Text, default="")

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    attempt: Mapped["ExamAttempt"] = relationship(back_populates="answers")
    question: Mapped["Question"] = relationship()
