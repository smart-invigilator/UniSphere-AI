from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select
from app.db.session import get_db
from app.api.deps import get_current_user, require_roles
from app.models.user import User, Role
from app.models.student import Student
from app.models.exam import ExamSession, Question
from app.models.attempt import ExamAttempt
from app.models.answer import Answer
from app.models.alert import Alert
from app.models.identity_log import IdentityCheckLog
from app.schemas.attempt import (
    AttemptOut, FaceEnrollIn, FaceEnrollOut, LivenessCheckIn, LivenessCheckOut,
    LivenessStepIn, LivenessStepOut, AnswerIn, AnswerOut, GradeAnswerIn, SubmitExamOut,
)
from app.core.config import settings
from app.ai.analyzer import analyzer
from app.ai.face_id import face_identifier
from app.ai.utils import decode_b64_jpeg
from app.services.risk import compute_risk
from app.services.report import build_attempt_report

router = APIRouter(prefix="/attempts", tags=["attempts"])

LIVENESS_YAW_THRESHOLD = 9.0  
DEADLINE_GRACE_SECONDS = 60  


def _attempt_deadline(a: ExamAttempt) -> "datetime | None":
    if not a.started_at:
        return None
    from datetime import timedelta
    return a.started_at + timedelta(minutes=a.exam.duration_minutes, seconds=DEADLINE_GRACE_SECONDS)


def _get_attempt(attempt_id: int, db: DBSession) -> ExamAttempt:
    a = db.get(ExamAttempt, attempt_id)
    if not a:
        raise HTTPException(404, "Attempt not found")
    return a


def _own_attempt(attempt_id: int, user: User, db: DBSession) -> ExamAttempt:
    a = _get_attempt(attempt_id, db)
    prof = db.scalar(select(Student).where(Student.user_id == user.id))
    if not prof or a.student_id != prof.id:
        raise HTTPException(403, "Not your attempt")
    return a


@router.get("/{attempt_id}", response_model=AttemptOut)
def get_attempt(attempt_id: int, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    a = _get_attempt(attempt_id, db)
    if user.role == Role.student:
        _own_attempt(attempt_id, user, db)
    elif a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Forbidden")
    return a



@router.post("/{attempt_id}/checklist/camera", response_model=AttemptOut)
def check_camera(attempt_id: int, db: DBSession = Depends(get_db),
                  user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    a.camera_ok = True
    db.commit()
    db.refresh(a)
    return a


@router.post("/{attempt_id}/checklist/microphone", response_model=AttemptOut)
def check_microphone(attempt_id: int, db: DBSession = Depends(get_db),
                      user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    a.microphone_ok = True
    db.commit()
    db.refresh(a)
    return a


@router.post("/{attempt_id}/checklist/screen", response_model=AttemptOut)
def check_screen(attempt_id: int, db: DBSession = Depends(get_db),
                  user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    a.screen_ok = True
    db.commit()
    db.refresh(a)
    return a


@router.post("/{attempt_id}/checklist/enroll-face", response_model=FaceEnrollOut)
def enroll_face(attempt_id: int, data: FaceEnrollIn, db: DBSession = Depends(get_db),
                 user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)

    if not analyzer.ready:
        raise HTTPException(503, "Face detection model unavailable on the server")
    if not face_identifier.ready:
        raise HTTPException(
            503,
            "ArcFace identity model not installed on the server (models/arcface.onnx missing). "
            "See README for setup instructions.",
        )

    embeddings = []
    occluded_count = 0
    for b64 in data.frames:
        frame = decode_b64_jpeg(b64)
        if frame is None:
            continue
        lm = analyzer.detect_face(frame, strict=False)
        if lm is None:
            continue
        visible, _, _ = face_identifier.face_visibility_quality(frame, lm)
        if not visible:
            occluded_count += 1
            continue
        emb = face_identifier.embed(frame, lm)
        if emb is not None:
            embeddings.append(emb)

    if len(embeddings) < max(1, len(data.frames) // 2):
        if occluded_count > len(data.frames) // 2:
            raise HTTPException(
                400,
                "Your face appears to be covered or not clearly visible. Make sure "
                "nothing is blocking your face, then try again.",
            )
        raise HTTPException(
            400,
            "Could not clearly capture your face in enough frames. Make sure only "
            "your face is visible, with good, even lighting, and try again.",
        )

    avg = face_identifier.average_embedding(embeddings)

    student = db.scalar(select(Student).where(Student.user_id == user.id))
    reg_embedding = student.registration_face_embedding if student else None

    if reg_embedding is None:
        
        raise HTTPException(
            403,
            "No registration photo on file for your account. Contact your "
            "instructor/admin to add one before you can start this exam.",
        )

    similarity = face_identifier.cosine_similarity(reg_embedding, avg)
    if similarity < settings.FACE_MATCH_THRESHOLD:
        raise HTTPException(
            403,
            "The face at the camera right now doesn't match your registered "
            "identity. Exam entry blocked. Contact your instructor if this "
            "is a mistake.",
        )

    a.reference_embedding = reg_embedding
    a.identity_verified = True
    a.identity_mismatch_streak = 0
    db.commit()
    return FaceEnrollOut(identity_verified=True, frames_used=len(embeddings),
                          message="Identity verified against your registered photo.")


@router.post("/{attempt_id}/checklist/liveness", response_model=LivenessCheckOut)
def liveness_check(attempt_id: int, data: LivenessCheckIn, db: DBSession = Depends(get_db),
                    user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)

    if not analyzer.ready:
        raise HTTPException(503, "Face detection model unavailable on the server")

    center = decode_b64_jpeg(data.center_frame)
    left = decode_b64_jpeg(data.left_frame)
    right = decode_b64_jpeg(data.right_frame)
    if center is None or left is None or right is None:
        raise HTTPException(400, "Could not decode one or more frames")

    lm_c = analyzer.detect_face(center, strict=False)
    lm_l = analyzer.detect_face(left, strict=False)
    lm_r = analyzer.detect_face(right, strict=False)
    if lm_c is None or lm_l is None or lm_r is None:
        return LivenessCheckOut(liveness_ok=False, message="Face not clearly detected in every frame — try again with better lighting.")

    yaw_c = analyzer.head_yaw(center, lm_c) or 0.0
    yaw_l = analyzer.head_yaw(left, lm_l)
    yaw_r = analyzer.head_yaw(right, lm_r)
    if yaw_l is None or yaw_r is None:
        return LivenessCheckOut(liveness_ok=False, message="Couldn't measure head pose — try again.")

    turned_apart = (yaw_l - yaw_c) * (yaw_r - yaw_c) < 0
    magnitude_ok = abs(yaw_l - yaw_c) > LIVENESS_YAW_THRESHOLD and abs(yaw_r - yaw_c) > LIVENESS_YAW_THRESHOLD
    ok = turned_apart and magnitude_ok

    if ok:
        a.liveness_ok = True
        db.commit()
        return LivenessCheckOut(liveness_ok=True, yaw_left=yaw_l, yaw_right=yaw_r,
                                 message="Liveness verified.")
    return LivenessCheckOut(
        liveness_ok=False, yaw_left=yaw_l, yaw_right=yaw_r,
        message="Head turn not detected clearly enough. Turn further left and right and try again.",
    )


@router.post("/{attempt_id}/checklist/liveness/step", response_model=LivenessStepOut)
def liveness_step(attempt_id: int, data: LivenessStepIn, db: DBSession = Depends(get_db),
                  user: User = Depends(require_roles(Role.student))):
    _own_attempt(attempt_id, user, db)

    if data.step not in {"straight", "left", "right"}:
        raise HTTPException(400, "Unknown liveness step")

    frame = decode_b64_jpeg(data.frame)
    if frame is None:
        return LivenessStepOut(step_ok=False, message="Your camera frame could not be read. Please try again.")
    landmarks = analyzer.detect_face(frame, strict=False)
    if landmarks is None:
        return LivenessStepOut(step_ok=False, message="Your face was not clearly detected. Please try again.")
    yaw = analyzer.head_yaw(frame, landmarks)
    if yaw is None:
        return LivenessStepOut(step_ok=False, message="Your head position could not be measured. Please try again.")

    if data.step == "straight":
        step_ok = abs(yaw) <= LIVENESS_YAW_THRESHOLD
        message = "Look straight at the camera and try again." if not step_ok else "Straight-ahead position confirmed."
    else:
        if not data.center_frame:
            raise HTTPException(400, "A straight-ahead frame is required")
        center = decode_b64_jpeg(data.center_frame)
        center_landmarks = analyzer.detect_face(center, strict=False) if center is not None else None
        center_yaw = analyzer.head_yaw(center, center_landmarks) if center_landmarks is not None else None
        if center_yaw is None:
            return LivenessStepOut(step_ok=False, message="Your straight-ahead position was lost. Please start again.")
        delta = yaw - center_yaw
        step_ok = delta > LIVENESS_YAW_THRESHOLD if data.step == "left" else delta < -LIVENESS_YAW_THRESHOLD
        direction = "left" if data.step == "left" else "right"
        message = f"Turn your head a little further {direction} and try again." if not step_ok else f"{direction.title()} position confirmed."

    return LivenessStepOut(step_ok=step_ok, message=message)


@router.post("/{attempt_id}/enter", response_model=AttemptOut)
def enter_exam(attempt_id: int, db: DBSession = Depends(get_db),
                user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    exam = a.exam
    if exam.security.get("camera", True) and not a.camera_ok:
        raise HTTPException(400, "Camera check not completed")
    if exam.security.get("microphone", True) and not a.microphone_ok:
        raise HTTPException(400, "Microphone check not completed")
    if exam.security.get("screenShare", True) and not a.screen_ok:
        raise HTTPException(400, "Screen share check not completed")
    if exam.security.get("identity", True) and not a.identity_verified:
        raise HTTPException(400, "Identity verification not completed")
    if exam.security.get("liveness", True) and not a.liveness_ok:
        raise HTTPException(400, "Liveness check not completed")

    if a.status not in ("in_progress",):
        if exam.scheduled_end and datetime.now(timezone.utc) > exam.scheduled_end:
            raise HTTPException(400, "This exam's submission window has closed.")
        a.status = "in_progress"
        a.started_at = datetime.now(timezone.utc)
    if exam.status == "published":
        exam.status = "active"
    db.commit()
    db.refresh(a)
    return a


@router.post("/{attempt_id}/answer", response_model=AnswerOut)
def submit_answer(attempt_id: int, data: AnswerIn, db: DBSession = Depends(get_db),
                   user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    if a.status != "in_progress":
        raise HTTPException(400, "Attempt is not in progress")
    deadline = _attempt_deadline(a)
    if deadline and datetime.now(timezone.utc) > deadline:
        raise HTTPException(400, "Time is up for this exam. Submit your exam now.")
    q = db.get(Question, data.question_id)
    if not q or q.exam_id != a.exam_id:
        raise HTTPException(404, "Question not found in this exam")

    ans = db.scalar(select(Answer).where(Answer.attempt_id == a.id, Answer.question_id == q.id))
    if not ans:
        ans = Answer(attempt_id=a.id, question_id=q.id)
        db.add(ans)
    ans.response = data.response
    db.commit()
    db.refresh(ans)
    return AnswerOut(question_id=q.id, response=ans.response, is_correct=ans.is_correct,
                      marks_awarded=ans.marks_awarded, feedback=ans.feedback)


@router.post("/{attempt_id}/submit", response_model=SubmitExamOut)
def submit_exam(attempt_id: int, db: DBSession = Depends(get_db),
                 user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    if a.status != "in_progress":
        raise HTTPException(400, "Attempt is not in progress")

    ungraded = 0
    auto_score = 0.0
    for q in a.exam.questions:
        ans = db.scalar(select(Answer).where(Answer.attempt_id == a.id, Answer.question_id == q.id))
        if not ans:
            ans = Answer(attempt_id=a.id, question_id=q.id, response="")
            db.add(ans)
        if q.type in ("mcq", "tf"):
            correct = (q.correct_answer or "").strip().lower() == (ans.response or "").strip().lower()
            ans.is_correct = correct
            ans.marks_awarded = float(q.marks) if correct else 0.0
            auto_score += ans.marks_awarded
        else:
            ungraded += 1 

    a.auto_score = auto_score
    a.manual_score = 0.0
    a.final_score = auto_score if ungraded == 0 else None
    a.status = "submitted" if ungraded > 0 else "graded"
    a.submitted_at = datetime.now(timezone.utc)
    db.commit()

    return SubmitExamOut(
        attempt_id=a.id, status=a.status, auto_score=auto_score,
        total_marks=a.exam.total_marks, ungraded_questions=ungraded,
        submitted_at=a.submitted_at,
    )


@router.get("/exam/{exam_id}", response_model=list[AttemptOut])
def list_exam_attempts(exam_id: int, db: DBSession = Depends(get_db),
                        user: User = Depends(require_roles(Role.teacher, Role.admin))):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    rows = db.scalars(select(ExamAttempt).where(ExamAttempt.exam_id == exam_id)).all()
    out = []
    for a in rows:
        item = AttemptOut.model_validate(a)
        item.student_name = a.student.user.name
        item.student_code = a.student.student_id
        item.student_email = a.student.user.email
        out.append(item)
    return out


@router.get("/{attempt_id}/risk")
def get_attempt_risk(attempt_id: int, db: DBSession = Depends(get_db),
                      user: User = Depends(require_roles(Role.teacher, Role.admin))):
    a = _get_attempt(attempt_id, db)
    if a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    return compute_risk(attempt_id, db)


@router.get("/exam/{exam_id}/risk")
def get_exam_risk(exam_id: int, db: DBSession = Depends(get_db),
                   user: User = Depends(require_roles(Role.teacher, Role.admin))):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    attempts = db.scalars(select(ExamAttempt).where(ExamAttempt.exam_id == exam_id)).all()
    out = []
    for a in attempts:
        risk = compute_risk(a.id, db)
        risk["student_id"] = a.student.student_id
        risk["student_name"] = a.student.user.name
        out.append(risk)
    return out


@router.get("/{attempt_id}/identity-log")
def get_identity_log(attempt_id: int, db: DBSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    a = _get_attempt(attempt_id, db)
    if user.role == Role.student:
        _own_attempt(attempt_id, user, db)
    elif a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Forbidden")
    rows = db.scalars(
        select(IdentityCheckLog).where(IdentityCheckLog.attempt_id == attempt_id)
        .order_by(IdentityCheckLog.timestamp.asc())
    ).all()
    return [
        {"timestamp": int(r.timestamp.timestamp() * 1000), "similarity": r.similarity, "is_match": r.is_match}
        for r in rows
    ]


@router.get("/{attempt_id}/report")
def get_attempt_report(attempt_id: int, db: DBSession = Depends(get_db),
                        user: User = Depends(require_roles(Role.teacher, Role.admin))):
    a = _get_attempt(attempt_id, db)
    if a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Forbidden")

    pdf_bytes = build_attempt_report(a, db)
    student_name = a.student.user.name.strip()
    safe_student_name = "".join(
        "_" if char in '<>:"/\\|?*' or ord(char) < 32 else char
        for char in student_name
    ).rstrip(" .") or f"student-{a.student_id}"
    filename = f"exam-report-{safe_student_name}-attempt-{a.id}.pdf"
    fallback_filename = f"exam-report-attempt-{a.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{fallback_filename}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
        },
    )


@router.get("/{attempt_id}/answers", response_model=list[AnswerOut])
def list_attempt_answers(attempt_id: int, db: DBSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    a = _get_attempt(attempt_id, db)
    if user.role == Role.student:
        _own_attempt(attempt_id, user, db)
    elif a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Forbidden")
    rows = db.scalars(select(Answer).where(Answer.attempt_id == attempt_id)).all()
    return [AnswerOut(question_id=r.question_id, response=r.response, is_correct=r.is_correct,
                       marks_awarded=r.marks_awarded, feedback=r.feedback) for r in rows]


@router.post("/{attempt_id}/grade/{question_id}", response_model=AnswerOut)
def grade_answer(attempt_id: int, question_id: int, data: GradeAnswerIn,
                 db: DBSession = Depends(get_db),
                 user: User = Depends(require_roles(Role.teacher, Role.admin))):
    a = _get_attempt(attempt_id, db)
    if a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    if a.status not in ("submitted", "graded"):
        raise HTTPException(400, "Only submitted attempts can be graded")
    q = db.get(Question, question_id)
    if not q or q.exam_id != a.exam_id:
        raise HTTPException(404, "Question not found in this exam")
    ans = db.scalar(select(Answer).where(Answer.attempt_id == attempt_id, Answer.question_id == question_id))
    if not ans:
        raise HTTPException(404, "Answer not found")
    if data.marks_awarded > float(q.marks):
        raise HTTPException(422, f"Marks cannot exceed the question maximum of {q.marks}.")
    ans.marks_awarded = data.marks_awarded
    ans.feedback = data.feedback
    ans.graded_by = user.id
    ans.graded_at = datetime.now(timezone.utc)
    all_answers = db.scalars(select(Answer).where(Answer.attempt_id == attempt_id)).all()
    short_question_ids = {exam_question.id for exam_question in a.exam.questions
                          if exam_question.type == "short"}
    answers_by_question = {answer.question_id: answer for answer in all_answers}
    manual_total = sum(
        answer.marks_awarded
        for answer in all_answers
        if answer.question_id in short_question_ids
    )
    all_graded = all(
        question_id in answers_by_question
        and answers_by_question[question_id].graded_at is not None
        for question_id in short_question_ids
    )
    a.manual_score = manual_total
    if all_graded:
        a.final_score = sum(answer.marks_awarded for answer in all_answers)
        a.status = "graded"
    db.commit()
    db.refresh(ans)
    return AnswerOut(question_id=ans.question_id, response=ans.response, is_correct=ans.is_correct,
                      marks_awarded=ans.marks_awarded, feedback=ans.feedback)