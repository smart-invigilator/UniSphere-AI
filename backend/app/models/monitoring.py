from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class MonitoringEvent(Base):
    __tablename__ = "monitoring_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int | None] = mapped_column(
        ForeignKey("exam_attempts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(80))
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )


class AttentionScore(Base):
    __tablename__ = "attention_scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int | None] = mapped_column(
        ForeignKey("exam_attempts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    score: Mapped[float] = mapped_column(Float)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
