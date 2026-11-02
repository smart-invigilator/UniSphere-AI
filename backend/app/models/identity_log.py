from datetime import datetime, timezone
from sqlalchemy import DateTime, Float, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


class IdentityCheckLog(Base):
    """A sampled record of every periodic ArcFace identity re-verification
    performed during an attempt — not just the mismatches that already
    produce an Alert row. This is the genuine value-add over the Alert
    table: a continuous "checked at 10:03:12, similarity 0.91, matched"
    audit trail, useful for demonstrating the identity check actually ran
    throughout the exam, not only for showing where it failed.

    Sampled rather than logging every single check (which runs every few
    seconds per student) to keep table growth reasonable — see
    IDENTITY_LOG_SAMPLE_EVERY in socket_server.py."""

    __tablename__ = "identity_check_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("exam_attempts.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    similarity: Mapped[float] = mapped_column(Float)
    is_match: Mapped[bool] = mapped_column(Boolean)