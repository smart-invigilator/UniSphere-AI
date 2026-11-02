from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select, func
from app.db.session import get_db
from app.api.deps import get_current_user, require_roles
from app.models.user import User, Role
from app.models.student import Student
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.exam import ExamSession
from app.schemas.course import CourseCreate, CourseOut, EnrollByEmail, EnrollByCode, RosterStudentOut

router = APIRouter(prefix="/courses", tags=["courses"])


def _course_out(c: Course, db: DBSession) -> CourseOut:
    student_count = db.scalar(
        select(func.count(Enrollment.id)).where(Enrollment.course_id == c.id)
    ) or 0
    exam_count = db.scalar(
        select(func.count(ExamSession.id)).where(ExamSession.course_id == c.id)
    ) or 0
    return CourseOut(
        id=c.id, title=c.title, subject=c.subject, description=c.description,
        code=c.code, teacher_id=c.teacher_id, teacher_name=c.teacher.name,
        student_count=student_count, exam_count=exam_count, created_at=c.created_at,
    )


def _get_owned_course(course_id: int, user: User, db: DBSession) -> Course:
    c = db.get(Course, course_id)
    if not c:
        raise HTTPException(404, "Course not found")
    if c.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your course")
    return c


@router.post("", response_model=CourseOut, status_code=201)
def create_course(
    data: CourseCreate,
    db: DBSession = Depends(get_db),
    user: User = Depends(require_roles(Role.teacher, Role.admin)),
):
    c = Course(teacher_id=user.id, title=data.title, subject=data.subject,
               description=data.description)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _course_out(c, db)


@router.get("/mine", response_model=list[CourseOut])
def my_courses(db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role in (Role.teacher, Role.admin):
        rows = db.scalars(select(Course).where(Course.teacher_id == user.id)).all()
    else:
        prof = db.scalar(select(Student).where(Student.user_id == user.id))
        if not prof:
            return []
        rows = db.scalars(
            select(Course).join(Enrollment).where(Enrollment.student_id == prof.id)
        ).all()
    return [_course_out(c, db) for c in rows]


@router.get("/{course_id}", response_model=CourseOut)
def get_course(course_id: int, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    c = db.get(Course, course_id)
    if not c:
        raise HTTPException(404, "Course not found")
    if user.role == Role.student:
        prof = db.scalar(select(Student).where(Student.user_id == user.id))
        enrolled = prof and db.scalar(
            select(Enrollment).where(Enrollment.course_id == course_id, Enrollment.student_id == prof.id)
        )
        if not enrolled:
            raise HTTPException(403, "Not enrolled in this course")
    elif c.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your course")
    return _course_out(c, db)


@router.get("/{course_id}/roster", response_model=list[RosterStudentOut])
def roster(course_id: int, db: DBSession = Depends(get_db),
           user: User = Depends(require_roles(Role.teacher, Role.admin))):
    _get_owned_course(course_id, user, db)
    rows = db.scalars(
        select(Enrollment).where(Enrollment.course_id == course_id)
    ).all()
    out = []
    for e in rows:
        st = e.student
        out.append(RosterStudentOut(
            student_id=st.student_id, name=st.user.name, email=st.user.email,
            department=st.department, enrolled_at=e.enrolled_at, method=e.method,
        ))
    return out


@router.post("/{course_id}/students", response_model=RosterStudentOut, status_code=201)
def add_student_by_email(course_id: int, data: EnrollByEmail, db: DBSession = Depends(get_db),
                          user: User = Depends(require_roles(Role.teacher, Role.admin))):
    course = _get_owned_course(course_id, user, db)
    target = db.scalar(select(User).where(User.email == data.email))
    if not target or target.role != Role.student or not target.student_profile:
        raise HTTPException(404, "No student account found with that email")
    st = target.student_profile
    exists = db.scalar(
        select(Enrollment).where(Enrollment.course_id == course.id, Enrollment.student_id == st.id)
    )
    if exists:
        raise HTTPException(409, "Student already enrolled")
    e = Enrollment(course_id=course.id, student_id=st.id, method="manual")
    db.add(e)
    db.commit()
    return RosterStudentOut(student_id=st.student_id, name=target.name, email=target.email,
                             department=st.department, enrolled_at=e.enrolled_at, method="manual")


@router.delete("/{course_id}/students/{student_id}", status_code=204)
def remove_student(course_id: int, student_id: str, db: DBSession = Depends(get_db),
                    user: User = Depends(require_roles(Role.teacher, Role.admin))):
    course = _get_owned_course(course_id, user, db)
    st = db.scalar(select(Student).where(Student.student_id == student_id))
    if not st:
        raise HTTPException(404, "Student not found")
    e = db.scalar(select(Enrollment).where(Enrollment.course_id == course.id, Enrollment.student_id == st.id))
    if not e:
        raise HTTPException(404, "Not enrolled")
    db.delete(e)
    db.commit()


@router.post("/enroll", response_model=CourseOut)
def self_enroll(data: EnrollByCode, db: DBSession = Depends(get_db),
                 user: User = Depends(require_roles(Role.student))):
    course = db.scalar(select(Course).where(Course.code == data.code.strip().upper()))
    if not course:
        raise HTTPException(404, "Invalid course code")
    prof = db.scalar(select(Student).where(Student.user_id == user.id))
    if not prof:
        raise HTTPException(400, "No student profile on this account")
    exists = db.scalar(
        select(Enrollment).where(Enrollment.course_id == course.id, Enrollment.student_id == prof.id)
    )
    if exists:
        raise HTTPException(409, "Already enrolled in this course")
    db.add(Enrollment(course_id=course.id, student_id=prof.id, method="self"))
    db.commit()
    return _course_out(course, db)
