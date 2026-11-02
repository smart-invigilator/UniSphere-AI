from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select
from sqlalchemy.orm import defer
from app.models.student import Student
from app.models.user import User
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
    q = select(Alert).options(defer(Alert.screenshot)).order_by(Alert.timestamp.desc()).limit(limit)
    if attempt_id is not None:
        q = (select(Alert).options(defer(Alert.screenshot)).where(Alert.attempt_id == attempt_id)
             .order_by(Alert.timestamp.desc()).limit(limit))
    rows = db.scalars(q).all()
    return rows


@router.get("/exam/{exam_id}")
def list_exam_alerts(
    exam_id: int,
    limit: int = 200,
    db: DBSession = Depends(get_db),
    user=Depends(require_roles(Role.teacher, Role.admin)),
):
    """Alert history for one exam session, in the same shape the realtime
    'alert' socket event uses — so the Live Monitoring page can seed its
    alert list with this on load/reconnect (e.g. after a page reload) and
    merge live events into it without any extra reshaping. Alerts only ever
    lived in the browser's in-memory state before this, so reloading the
    monitoring page silently lost all alert history for the session even
    though it was safely persisted in the database the whole time.
    """
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")

    rows = db.execute(
        select(
            Alert.id, Alert.alert_type, Alert.severity, Alert.confidence, Alert.timestamp,
            Alert.reviewed, Alert.notes, Student.student_id, User.name,
        )
        .join(ExamAttempt, Alert.attempt_id == ExamAttempt.id)
        .join(Student, Alert.student_id == Student.id)
        .join(User, Student.user_id == User.id)
        .where(ExamAttempt.exam_id == exam_id)
        .order_by(Alert.timestamp.desc())
        .limit(limit)
    ).all()

    return [
        {
            "id": f"ALT-{r.id:06d}",
            "studentId": r.student_id,
            "studentName": r.name,
            "type": r.alert_type,
            "severity": r.severity,
            "confidence": r.confidence,
            "timestamp": int(r.timestamp.timestamp() * 1000),
            "reviewed": r.reviewed,
            "notes": r.notes,
        }
        for r in rows
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