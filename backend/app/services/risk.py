
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select
from app.models.alert import Alert

SEVERITY_WEIGHTS = {"low": 1, "medium": 3, "high": 7}
RISK_LOW_MAX = 15      
RISK_MEDIUM_MAX = 40 


def risk_level(score: float) -> str:
    if score < RISK_LOW_MAX:
        return "low"
    if score < RISK_MEDIUM_MAX:
        return "medium"
    return "high"


def compute_risk(attempt_id: int, db: DBSession) -> dict:
    rows = db.scalars(select(Alert).where(Alert.attempt_id == attempt_id)).all()
    counts = {"low": 0, "medium": 0, "high": 0}
    for a in rows:
        if a.severity in counts:
            counts[a.severity] += 1
    score = sum(SEVERITY_WEIGHTS[sev] * n for sev, n in counts.items())
    return {
        "attempt_id": attempt_id,
        "suspicion_score": score,
        "risk_level": risk_level(score),
        "alert_counts": counts,
        "total_alerts": len(rows),
    }