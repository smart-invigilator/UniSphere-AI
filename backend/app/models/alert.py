from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Float, ForeignKey, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int | None] = mapped_column(
        ForeignKey("exam_attempts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    alert_type: Mapped[str] = mapped_column(String(80))
    severity: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    # Base64 JPEG of the exact frame that triggered this alert (we already
    # have it in memory from the incoming socket frame at zero extra
    # capture cost — this just persists it instead of discarding it).
    # Only populated for frame-driven alerts; browser-event alerts
    # (tab-switch, copy/paste, etc.) have no associated frame.
    screenshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )

    student: Mapped["Student"] = relationship(back_populates="alerts")