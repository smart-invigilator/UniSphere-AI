from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select, func
from app.db.session import get_db
from app.api.deps import get_current_user, require_roles
from app.models.user import User, Role
from app.models.student import Student
from app.models.alert import Alert
from app.schemas.student import StudentOut, StudentUpdate
from app.realtime.manager import manager

router = APIRouter(prefix="/students", tags=["students"])


def _merge_live(rows, db):
    live = {s["id"]: s for s in manager.snapshot()}
    out = []
    for st in rows:
        alert_count = db.scalar(
            select(func.count(Alert.id)).where(Alert.student_id == st.id)
        ) or 0
        lv = live.get(st.student_id, {})
        out.append(StudentOut(
            id=st.id, student_id=st.student_id, name=st.user.name,
            department=st.department, session_label=st.session_label,
            attendance=st.attendance,
            status=lv.get("status", "offline"),
            attention=lv.get("attention", 100),
            alert_count=lv.get("alertCount", alert_count),
            connected=lv.get("connected", False),
        ))
    return out


@router.get("", response_model=list[StudentOut])
def list_students(
    db: DBSession = Depends(get_db),
    user: User = Depends(require_roles(Role.teacher, Role.admin)),
):
    rows = db.scalars(select(Student)).all()
    return _merge_live(rows, db)


@router.get("/{student_id}", response_model=StudentOut)
def get_student(
    student_id: str,
    db: DBSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    st = db.scalar(select(Student).where(Student.student_id == student_id))
    if not st:
        raise HTTPException(404, "Student not found")
    if user.role == Role.student and st.user_id != user.id:
        raise HTTPException(403, "Forbidden")
    return _merge_live([st], db)[0]


@router.patch("/{student_id}", response_model=StudentOut)
def update_student(
    student_id: str, data: StudentUpdate,
    db: DBSession = Depends(get_db),
    user: User = Depends(require_roles(Role.admin)),
):
    st = db.scalar(select(Student).where(Student.student_id == student_id))
    if not st:
        raise HTTPException(404, "Student not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(st, k, v)
    db.commit()
    return _merge_live([st], db)[0]
