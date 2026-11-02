"""Suspicion score / risk-level computation — pure aggregation over
persisted alerts, shared by the attempts API (GET /risk endpoints) and the
PDF report generator so both always agree on the same numbers."""
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select, func
from app.models.alert import Alert

# Reasonable starting points, not a validated model — tune per deployment
# as real data comes in.
SEVERITY_WEIGHTS = {"low": 1, "medium": 3, "high": 7}
RISK_LOW_MAX = 15      # score < this -> "low"
RISK_MEDIUM_MAX = 40   # score < this -> "medium"; >= this -> "high"


def risk_level(score: float) -> str:
    if score < RISK_LOW_MAX:
        return "low"
    if score < RISK_MEDIUM_MAX:
        return "medium"
    return "high"


def _risk_dict(attempt_id: int, severity_counts: dict) -> dict:
    counts = {"low": 0, "medium": 0, "high": 0}
    total = 0
    for sev, n in severity_counts.items():
        total += n
        if sev in counts:
            counts[sev] += n
    score = sum(SEVERITY_WEIGHTS[sev] * n for sev, n in counts.items())
    return {
        "attempt_id": attempt_id,
        "suspicion_score": score,
        "risk_level": risk_level(score),
        "alert_counts": counts,
        "total_alerts": total,
    }


def compute_risk(attempt_id: int, db: DBSession) -> dict:
    rows = db.execute(
        select(Alert.severity, func.count(Alert.id))
        .where(Alert.attempt_id == attempt_id)
        .group_by(Alert.severity)
    ).all()
    return _risk_dict(attempt_id, {sev: n for sev, n in rows})


def compute_risk_bulk(attempt_ids: list[int], db: DBSession) -> dict[int, dict]:
    if not attempt_ids:
        return {}
    rows = db.execute(
        select(Alert.attempt_id, Alert.severity, func.count(Alert.id))
        .where(Alert.attempt_id.in_(attempt_ids))
        .group_by(Alert.attempt_id, Alert.severity)
    ).all()
    grouped: dict[int, dict] = {aid: {} for aid in attempt_ids}
    for aid, sev, n in rows:
        grouped[aid][sev] = n
    return {aid: _risk_dict(aid, grouped[aid]) for aid in attempt_ids}