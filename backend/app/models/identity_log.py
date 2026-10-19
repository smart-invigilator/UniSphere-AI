from datetime import datetime, timezone
from sqlalchemy import DateTime, Float, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


class IdentityCheckLog(Base):
    
    __tablename__ = "identity_check_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("exam_attempts.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    similarity: Mapped[float] = mapped_column(Float)
    is_match: Mapped[bool] = mapped_column(Boolean)