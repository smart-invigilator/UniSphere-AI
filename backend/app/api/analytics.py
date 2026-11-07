from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select, func
from app.db.session import get_db
from app.core.refs import ExamIn
from app.api.deps import require_roles
from app.models.user import Role
from app.models.alert import Alert
from app.models.student import Student
from app.models.exam import ExamSession
from app.models.attempt import ExamAttempt
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.realtime.manager import manager

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary")
def summary(
    exam_id: ExamIn | None = None,
    db: DBSession = Depends(get_db),
    user=Depends(require_roles(Role.teacher, Role.admin)),
):
    """Global summary, or scoped to a single exam if exam_id is given (and
    owned by the requesting teacher)."""
    if exam_id is not None:
        exam = db.get(ExamSession, exam_id)
        if not exam:
            raise HTTPException(404, "Exam not found")
        if exam.course.teacher_id != user.id and user.role != Role.admin:
            raise HTTPException(403, "Not your exam")

    live = manager.snapshot(exam_id)
    own_exam_ids = own_student_ids = None
    if exam_id is None and user.role != Role.admin:
        # Global view for a teacher is limited to their own courses.
        own_exam_ids = select(ExamSession.id).join(Course, ExamSession.course_id == Course.id).where(Course.teacher_id == user.id)
        own_student_ids = select(Enrollment.student_id).join(Course, Enrollment.course_id == Course.id).where(Course.teacher_id == user.id)
        codes = set(db.scalars(select(Student.student_id).where(Student.id.in_(own_student_ids))).all())
        live = [s for s in live if s.get("id") in codes]

    if exam_id is not None:
        total = db.scalar(select(func.count(ExamAttempt.id)).where(ExamAttempt.exam_id == exam_id)) or 0
        alert_q = select(func.count(Alert.id)).join(
            ExamAttempt, Alert.attempt_id == ExamAttempt.id
        ).where(ExamAttempt.exam_id == exam_id)
        by_type_q = select(Alert.alert_type, func.count(Alert.id)).join(
            ExamAttempt, Alert.attempt_id == ExamAttempt.id
        ).where(ExamAttempt.exam_id == exam_id).group_by(Alert.alert_type)
    else:
        if own_exam_ids is not None:
            total = db.scalar(select(func.count(Student.id)).where(Student.id.in_(own_student_ids))) or 0
            scope = Alert.attempt_id.in_(select(ExamAttempt.id).where(ExamAttempt.exam_id.in_(own_exam_ids)))
            alert_q = select(func.count(Alert.id)).where(scope)
            by_type_q = select(Alert.alert_type, func.count(Alert.id)).where(scope).group_by(Alert.alert_type)
        else:
            total = db.scalar(select(func.count(Student.id))) or 0
            alert_q = select(func.count(Alert.id))
            by_type_q = select(Alert.alert_type, func.count(Alert.id)).group_by(Alert.alert_type)

    active = sum(1 for s in live if s["connected"])
    under_alert = sum(1 for s in live if s["status"] == "alert")
    total_alerts = db.scalar(alert_q) or 0
    avg_attention = (
        round(sum(s["attention"] for s in live) / len(live)) if live else 0
    )
    by_type = dict(db.execute(by_type_q).all())

    return {
        "totalStudents": total,
        "activeStudents": active,
        "alertStudents": under_alert,
        "offlineStudents": max(0, total - active),
        "totalAlerts": total_alerts,
        "avgAttention": avg_attention,
        "alertsByType": by_type,
    }
