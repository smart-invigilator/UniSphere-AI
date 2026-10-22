from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select, func
from app.db.session import get_db
from app.api.deps import get_current_user, require_roles
from app.models.user import User, Role
from app.models.student import Student
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.exam import ExamSession, Question
from app.models.attempt import ExamAttempt
from app.schemas.exam import ExamCreate, ExamUpdate, ExamOut, ExamJoinByCode, QuestionOut, QuestionAnswerKeyOut
from app.schemas.attempt import AttemptOut
from app.services.question_types import QuestionError, build_question_fields, public_config

router = APIRouter(prefix="/exams", tags=["exams"])


def _exam_out(e: ExamSession, db: DBSession, my_attempt: "ExamAttempt | None" = None) -> ExamOut:
    qcount = db.scalar(select(func.count(Question.id)).where(Question.exam_id == e.id)) or 0
    is_closed = bool(
        e.scheduled_end
        and e.status in ("published", "active")
        and datetime.now(timezone.utc) > e.scheduled_end
    )
    return ExamOut(
        id=e.id, course_id=e.course_id, course_title=e.course.title, title=e.title,
        description=e.description, code=e.code, duration_minutes=e.duration_minutes,
        total_marks=e.total_marks, scheduled_start=e.scheduled_start, scheduled_end=e.scheduled_end,
        status=e.status, is_closed=is_closed, security=e.security, question_count=qcount,
        created_at=e.created_at,
        my_attempt_status=my_attempt.status if my_attempt else None,
        my_final_score=my_attempt.final_score if my_attempt else None,
        my_auto_score=my_attempt.auto_score if my_attempt else None,
    )


def _question_rows(questions) -> list[dict]:
    rows = []
    for i, q in enumerate(questions):
        try:
            row = build_question_fields(q)
        except QuestionError as e:
            raise HTTPException(422, f"Question {i + 1}: {e}")
        row["order"] = i
        rows.append(row)
    return rows


def _student_question(q: Question, student_seed: str) -> QuestionOut:
    return QuestionOut(
        id=q.id, type=q.type, text=q.text, options=q.options, marks=q.marks,
        order=q.order, config=public_config(q, student_seed), image_url=q.image_url,
    )


def _require_enrolled_student(exam: ExamSession, user: User, db: DBSession) -> Student:
    prof = db.scalar(select(Student).where(Student.user_id == user.id))
    if not prof:
        raise HTTPException(400, "No student profile on this account")
    enrolled = db.scalar(
        select(Enrollment).where(Enrollment.course_id == exam.course_id, Enrollment.student_id == prof.id)
    )
    if not enrolled:
        raise HTTPException(403, "You must be enrolled in this course to access this exam")
    return prof


@router.post("", response_model=ExamOut, status_code=201)
def create_exam(data: ExamCreate, db: DBSession = Depends(get_db),
                 user: User = Depends(require_roles(Role.teacher, Role.admin))):
    course = db.get(Course, data.course_id)
    if not course:
        raise HTTPException(404, "Course not found")
    if course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your course")

    rows = _question_rows(data.questions)
    total_marks = sum(r["marks"] for r in rows) or 100
    exam = ExamSession(
        course_id=course.id, title=data.title, description=data.description,
        duration_minutes=data.duration_minutes, total_marks=total_marks,
        scheduled_start=data.scheduled_start, scheduled_end=data.scheduled_end,
        security=data.security.model_dump(), status="draft",
    )
    db.add(exam)
    db.flush()
    db.add_all([Question(exam_id=exam.id, **r) for r in rows])
    db.commit()
    db.refresh(exam)
    return _exam_out(exam, db)


@router.post("/{exam_id}/publish", response_model=ExamOut)
def publish_exam(exam_id: int, db: DBSession = Depends(get_db),
                  user: User = Depends(require_roles(Role.teacher, Role.admin))):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    exam.status = "published"
    db.commit()
    db.refresh(exam)
    return _exam_out(exam, db)


@router.patch("/{exam_id}", response_model=ExamOut)
def update_exam(exam_id: int, data: ExamUpdate, db: DBSession = Depends(get_db),
                 user: User = Depends(require_roles(Role.teacher, Role.admin))):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    if exam.status != "draft":
        raise HTTPException(400, "Only draft exams can be edited. Published exams are locked.")

    rows = _question_rows(data.questions)  
    exam.title = data.title
    exam.description = data.description
    exam.duration_minutes = data.duration_minutes
    exam.scheduled_start = data.scheduled_start
    exam.scheduled_end = data.scheduled_end
    exam.security = data.security.model_dump()

    for q in list(exam.questions):
        db.delete(q)
    db.flush()
    db.add_all([Question(exam_id=exam.id, **r) for r in rows])
    exam.total_marks = sum(r["marks"] for r in rows) or 100

    db.commit()
    db.refresh(exam)
    return _exam_out(exam, db)


@router.delete("/{exam_id}", status_code=204)
def delete_exam(exam_id: int, db: DBSession = Depends(get_db),
                 user: User = Depends(require_roles(Role.teacher, Role.admin))):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")

    real_attempt = db.scalar(
        select(ExamAttempt).where(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.status.in_(("in_progress", "submitted", "graded")),
        )
    )
    if real_attempt:
        raise HTTPException(
            400,
            "This exam can't be deleted — at least one student has already started, "
            "submitted, or been graded on it.",
        )

    db.delete(exam) 
    db.commit()


@router.get("/course/{course_id}", response_model=list[ExamOut])
def list_course_exams(course_id: int, db: DBSession = Depends(get_db),
                       user: User = Depends(require_roles(Role.teacher, Role.admin))):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(404, "Course not found")
    if course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your course")
    rows = db.scalars(select(ExamSession).where(ExamSession.course_id == course_id)
                       .order_by(ExamSession.created_at.desc())).all()
    return [_exam_out(e, db) for e in rows]


@router.get("/mine", response_model=list[ExamOut])
def my_exams(db: DBSession = Depends(get_db), user: User = Depends(require_roles(Role.student))):
    prof = db.scalar(select(Student).where(Student.user_id == user.id))
    if not prof:
        return []
    course_ids = db.scalars(
        select(Enrollment.course_id).where(Enrollment.student_id == prof.id)
    ).all()
    if not course_ids:
        return []
    rows = db.scalars(
        select(ExamSession)
        .where(ExamSession.course_id.in_(course_ids), ExamSession.status != "draft")
        .order_by(ExamSession.scheduled_start.asc().nulls_last())
    ).all()
    if not rows:
        return []
    attempts_by_exam = {
        a.exam_id: a
        for a in db.scalars(
            select(ExamAttempt).where(
                ExamAttempt.student_id == prof.id,
                ExamAttempt.exam_id.in_([e.id for e in rows]),
            )
        ).all()
    }
    return [_exam_out(e, db, my_attempt=attempts_by_exam.get(e.id)) for e in rows]


@router.get("/{exam_id}", response_model=ExamOut)
def get_exam(exam_id: int, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if user.role == Role.student:
        _require_enrolled_student(exam, user, db)
    elif exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    return _exam_out(exam, db)


@router.get("/{exam_id}/questions", response_model=list[QuestionOut] | list[QuestionAnswerKeyOut])
def get_questions(exam_id: int, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if user.role == Role.student:
        prof = _require_enrolled_student(exam, user, db)
        attempt = db.scalar(
            select(ExamAttempt).where(ExamAttempt.exam_id == exam_id, ExamAttempt.student_id == prof.id)
        )
        if not attempt or attempt.status not in ("in_progress", "submitted", "graded"):
            raise HTTPException(403, "Start the exam attempt before viewing questions")
        return [_student_question(q, f"{user.id}") for q in exam.questions]
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    return [QuestionAnswerKeyOut.model_validate(q) for q in exam.questions]


def _get_or_create_attempt(exam: ExamSession, prof: Student, db: DBSession) -> ExamAttempt:
    attempt = db.scalar(
        select(ExamAttempt).where(ExamAttempt.exam_id == exam.id, ExamAttempt.student_id == prof.id)
    )
    if not attempt:
        if exam.scheduled_end and datetime.now(timezone.utc) > exam.scheduled_end:
            raise HTTPException(400, "This exam's submission window has closed.")
        attempt = ExamAttempt(exam_id=exam.id, student_id=prof.id, status="checklist")
        db.add(attempt)
        db.commit()
        db.refresh(attempt)
    else:
        if attempt.status == "not_started":
            if exam.scheduled_end and datetime.now(timezone.utc) > exam.scheduled_end:
                raise HTTPException(400, "This exam's submission window has closed.")
            attempt.status = "checklist"
        attempt.liveness_ok = False
        db.commit()
    return attempt


@router.post("/{exam_id}/start", response_model=AttemptOut)
def start_attempt(exam_id: int, db: DBSession = Depends(get_db),
                   user: User = Depends(require_roles(Role.student))):

    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.status not in ("published", "active"):
        raise HTTPException(400, "This exam is not open yet")
    prof = _require_enrolled_student(exam, user, db)
    return _get_or_create_attempt(exam, prof, db)


@router.post("/join", response_model=AttemptOut)
def join_by_code(data: ExamJoinByCode, db: DBSession = Depends(get_db),
                  user: User = Depends(require_roles(Role.student))):
    exam = db.scalar(select(ExamSession).where(ExamSession.code == data.code.strip().upper()))
    if not exam:
        raise HTTPException(404, "Invalid exam code")
    if exam.status not in ("published", "active"):
        raise HTTPException(400, "This exam is not open for joining")
    prof = _require_enrolled_student(exam, user, db)
    return _get_or_create_attempt(exam, prof, db)