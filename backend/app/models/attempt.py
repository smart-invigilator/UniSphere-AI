from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Float, Boolean, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


class ExamAttempt(Base):

    __tablename__ = "exam_attempts"
    __table_args__ = (UniqueConstraint("exam_id", "student_id", name="uq_exam_student_attempt"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exam_sessions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="not_started")

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    auto_score: Mapped[float] = mapped_column(Float, default=0.0)
    manual_score: Mapped[float] = mapped_column(Float, default=0.0)
    final_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    camera_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    microphone_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    screen_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    liveness_ok: Mapped[bool] = mapped_column(Boolean, default=False)

    identity_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    reference_embedding: Mapped[list | None] = mapped_column(JSON, nullable=True) 
    last_face_similarity: Mapped[float | None] = mapped_column(Float, nullable=True)
    identity_mismatch_streak: Mapped[int] = mapped_column(default=0)

    exam: Mapped["ExamSession"] = relationship(back_populates="attempts")
    student: Mapped["Student"] = relationship(back_populates="attempts")
    answers: Mapped[list["Answer"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan"
    )

    @property
    def checklist_passed(self) -> bool:
        return self.camera_ok and self.microphone_ok and self.screen_ok and \
            self.identity_verified and self.liveness_ok
