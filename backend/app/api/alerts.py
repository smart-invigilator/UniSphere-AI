from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select
from app.db.session import get_db
from app.api.deps import require_roles
from app.models.user import Role
from app.models.alert import Alert
from app.models.attempt import ExamAttempt
from app.models.exam import ExamSession
from app.schemas.alert import AlertOut, AlertReview

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertOut])
def list_alerts(
    limit: int = 100,
    attempt_id: int | None = None,
    db: DBSession = Depends(get_db),
    user=Depends(require_roles(Role.teacher, Role.admin)),
):
    q = select(Alert).order_by(Alert.timestamp.desc()).limit(limit)
    if attempt_id is not None:
        q = select(Alert).where(Alert.attempt_id == attempt_id).order_by(Alert.timestamp.desc()).limit(limit)
    rows = db.scalars(q).all()
    return rows


@router.get("/exam/{exam_id}")
def list_exam_alerts(
    exam_id: int,
    limit: int = 200,
    db: DBSession = Depends(get_db),
    user=Depends(require_roles(Role.teacher, Role.admin)),
):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")

    rows = db.scalars(
        select(Alert)
        .join(ExamAttempt, Alert.attempt_id == ExamAttempt.id)
        .where(ExamAttempt.exam_id == exam_id)
        .order_by(Alert.timestamp.desc())
        .limit(limit)
    ).all()

    return [
        {
            "id": f"ALT-{a.id:06d}",
            "studentId": a.student.student_id,
            "studentName": a.student.user.name,
            "type": a.alert_type,
            "severity": a.severity,
            "confidence": a.confidence,
            "timestamp": int(a.timestamp.timestamp() * 1000),
            "reviewed": a.reviewed,
            "notes": a.notes,
        }
        for a in rows
    ]


@router.post("/{alert_id}/review", response_model=AlertOut)
def review_alert(
    alert_id: int, data: AlertReview,
    db: DBSession = Depends(get_db),
    user=Depends(require_roles(Role.teacher, Role.admin)),
):
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(404, "Alert not found")
    a.reviewed = True
    if data.notes is not None:
        a.notes = data.notes
    db.commit()
    db.refresh(a)
    return a


@router.delete("/{alert_id}", status_code=204)
def delete_alert(
    alert_id: int,
    db: DBSession = Depends(get_db),
    user=Depends(require_roles(Role.admin)),
):
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(404, "Alert not found")
    db.delete(a)
    db.commit()