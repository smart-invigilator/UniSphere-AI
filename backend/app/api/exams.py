from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from app.db.session import get_db
from app.api.deps import get_current_user, require_roles
from app.models.user import User, Role
from app.models.student import Student
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.exam import ExamSession, Question
from app.models.attempt import ExamAttempt
from app.models.answer import Answer
from app.schemas.exam import ExamCreate, ExamUpdate, ExamOut, ExamJoinByCode, QuestionIn, QuestionOut, QuestionAnswerKeyOut
from app.schemas.attempt import AttemptOut
from app.services.question_types import public_view

router = APIRouter(prefix="/exams", tags=["exams"])


REAL_ATTEMPT_STATUSES = ("in_progress", "submitted", "graded")


def as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _exams_with_attempts(db: DBSession, exam_ids: list[int]) -> set[int]:
    if not exam_ids:
        return set()
    return set(db.scalars(
        select(ExamAttempt.exam_id)
        .where(ExamAttempt.exam_id.in_(exam_ids), ExamAttempt.status.in_(REAL_ATTEMPT_STATUSES))
        .distinct()
    ).all())


def _exam_out(e: ExamSession, db: DBSession, my_attempt: "ExamAttempt | None" = None, pending_grading: int = 0,
              has_attempts: bool | None = None) -> ExamOut:
    if has_attempts is None:
        has_attempts = bool(_exams_with_attempts(db, [e.id]))
    qcount = db.scalar(select(func.count(Question.id)).where(Question.exam_id == e.id)) or 0
    is_closed = bool(
        e.scheduled_end
        and e.status in ("published", "active")
        and datetime.now(timezone.utc) > as_utc(e.scheduled_end)
    )
    return ExamOut(
        id=e.id, course_id=e.course_id, course_title=e.course.title, title=e.title,
        description=e.description, code=e.code, duration_minutes=e.duration_minutes,
        total_marks=e.total_marks, scheduled_start=e.scheduled_start, scheduled_end=e.scheduled_end,
        status=e.status, is_closed=is_closed, security=e.security, question_count=qcount,
        created_at=e.created_at,
        my_attempt_id=my_attempt.id if my_attempt else None,
        my_attempt_status=my_attempt.status if my_attempt else None,
        my_final_score=my_attempt.final_score if my_attempt else None,
        my_auto_score=my_attempt.auto_score if my_attempt else None,
        my_manual_score=my_attempt.manual_score if my_attempt else None,
        my_pending_grading=pending_grading,
        has_attempts=has_attempts,
    )


def _build_question(exam_id: int, q: QuestionIn, order: int) -> Question:
    return Question(
        exam_id=exam_id, type=q.type, text=q.text, options=q.options,
        correct_answer=q.correct_answer, marks=q.marks, order=order,
        settings=q.settings or {}, media=[m.model_dump() for m in q.media],
        answer_key=q.answer_key,
    )


def _total_marks(questions: list[QuestionIn]) -> int:
    return sum(q.marks for q in questions) or 100


def _student_question(q: Question, seed: str) -> dict:
    options, pub = public_view(q, f"{seed}:{q.id}")
    return QuestionOut(
        id=q.id, type=q.type, text=q.text, options=options, marks=q.marks, order=q.order,
        media=q.media or [], settings=pub,
    ).model_dump(mode="json")


def _teacher_question(q: Question) -> dict:
    return QuestionAnswerKeyOut(
        id=q.id, type=q.type, text=q.text, options=q.options, marks=q.marks, order=q.order,
        media=q.media or [], settings=q.settings or {}, correct_answer=q.correct_answer,
        answer_key=q.answer_key,
    ).model_dump(mode="json")


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

    total_marks = _total_marks(data.questions)
    exam = ExamSession(
        course_id=course.id, title=data.title, description=data.description,
        duration_minutes=data.duration_minutes, total_marks=total_marks,
        scheduled_start=data.scheduled_start, scheduled_end=data.scheduled_end,
        security=data.security.model_dump(), status="draft",
    )
    db.add(exam)
    db.flush()
    db.add_all([_build_question(exam.id, q, i) for i, q in enumerate(data.questions)])
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
    locked = bool(_exams_with_attempts(db, [exam.id]))
    if data.questions is not None and locked:
        raise HTTPException(
            400,
            "Questions can't be changed after students have started this exam. "
            "You can still change the title, description, schedule, duration and security settings.",
        )
    if data.questions is None and exam.status == "draft":
        raise HTTPException(400, "Questions are required when editing a draft exam.")

    exam.title = data.title
    exam.description = data.description
    exam.duration_minutes = data.duration_minutes
    exam.scheduled_start = data.scheduled_start
    exam.scheduled_end = data.scheduled_end
    exam.security = data.security.model_dump()

    if data.questions is not None:
        for q in list(exam.questions):
            db.delete(q)
        db.flush()
        db.add_all([_build_question(exam.id, q, i) for i, q in enumerate(data.questions)])
        exam.total_marks = _total_marks(data.questions)

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
    started = _exams_with_attempts(db, [e.id for e in rows])
    return [_exam_out(e, db, has_attempts=e.id in started) for e in rows]


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
    attempt_ids = [a.id for a in attempts_by_exam.values()]
    pending = {}
    if attempt_ids:
        pending = dict(db.execute(
            select(Answer.attempt_id, func.count(Answer.id))
            .where(
                Answer.attempt_id.in_(attempt_ids),
                Answer.requires_manual.is_(True),
                Answer.graded_at.is_(None),
            )
            .group_by(Answer.attempt_id)
        ).all())
    out = []
    for e in rows:
        a = attempts_by_exam.get(e.id)
        out.append(_exam_out(e, db, my_attempt=a, pending_grading=int(pending.get(a.id, 0)) if a else 0, has_attempts=False))
    return out


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


@router.get("/{exam_id}/questions", response_model=None)
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
        return [_student_question(q, str(attempt.id)) for q in exam.questions]
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    return [_teacher_question(q) for q in exam.questions]


def _get_or_create_attempt(exam: ExamSession, prof: Student, db: DBSession) -> ExamAttempt:
    def find() -> "ExamAttempt | None":
        return db.scalar(
            select(ExamAttempt)
            .where(ExamAttempt.exam_id == exam.id, ExamAttempt.student_id == prof.id)
            .with_for_update()
        )

    def window_closed() -> bool:
        if not exam.scheduled_end:
            return False
        return datetime.now(timezone.utc) > as_utc(exam.scheduled_end)

    attempt = find()
    if not attempt:
        if window_closed():
            raise HTTPException(400, "This exam's submission window has closed.")
        attempt = ExamAttempt(exam_id=exam.id, student_id=prof.id, status="checklist")
        db.add(attempt)
        try:
            db.commit()
            db.refresh(attempt)
            return attempt
        except IntegrityError:
            db.rollback()
            attempt = find()
            if attempt is None:
                raise HTTPException(409, "Could not start the exam right now. Please try again.")
    if attempt.status == "not_started":
        if window_closed():
            raise HTTPException(400, "This exam's submission window has closed.")
        attempt.status = "checklist"
    attempt.liveness_ok = False
    db.commit()
    db.refresh(attempt)
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