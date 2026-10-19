from datetime import datetime
from pydantic import BaseModel


class AlertOut(BaseModel):
    id: int
    student_id: int
    attempt_id: int | None = None
    alert_type: str
    severity: str
    confidence: float
    reviewed: bool
    notes: str
    timestamp: datetime

    class Config:
        from_attributes = True


class AlertReview(BaseModel):
    notes: str | None = None
