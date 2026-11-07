from datetime import datetime
from pydantic import BaseModel
from app.core.refs import AttemptOut_


class AlertOut(BaseModel):
    id: int
    student_id: int
    attempt_id: AttemptOut_ | None = None
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
