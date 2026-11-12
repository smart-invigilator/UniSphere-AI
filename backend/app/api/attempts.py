from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.db.session import get_db
from app.core.refs import AttemptIn, ExamIn, ATTEMPT, encode_ref
from app.api.deps import get_current_user, require_roles
from app.api.exams import check_exam_window, as_utc
from app.models.user import User, Role
from app.models.student import Student
from app.models.exam import ExamSession, Question
from app.models.attempt import ExamAttempt
from app.models.answer import Answer
from app.models.alert import Alert
from app.models.identity_log import IdentityCheckLog
from app.schemas.attempt import (
    AttemptOut, FaceEnrollIn, FaceEnrollOut, LivenessCheckIn, LivenessCheckOut,
    LivenessStepIn, LivenessStepOut, AnswerIn, AnswerOut, GradeShortAnswerIn, SubmitExamOut,
    BulkGradeIn,
)
from app.schemas.exam import QuestionAnswerKeyOut
from app.core.config import settings
from app.ai.analyzer import analyzer
from app.ai.face_id import face_identifier
from app.ai import face_scan
from app.ai.utils import decode_b64_jpeg
from app.services.risk import compute_risk, compute_risk_bulk
from sqlalchemy.orm import selectinload
from app.services.report import build_attempt_report
from app.services.grading import grade, load_json
from app.services.question_types import NON_ANSWERABLE_TYPES, RICH_ANSWER_TYPES, allowed_components
from app.services.answer_document import AnswerDocumentError, validate_document, is_document_string

MAX_PLAIN_RESPONSE = 100_000

router = APIRouter(prefix="/attempts", tags=["attempts"])

# "Look straight" tolerance, and how far each head turn must go (degrees,
# relative to the straight-ahead frame) for the liveness check to accept it.
LIVENESS_STRAIGHT_MAX_YAW = 10.0
LIVENESS_YAW_THRESHOLD = 20.0
# Each turn must also point this far to the requested side in absolute terms,
# so a slightly-off "straight" frame can't make a small turn the other way count.
LIVENESS_MIN_ABS_YAW = 22.0


def _turned(step: str, yaw: float, center_yaw: float) -> bool:
    """yaw > 0 is the student's own LEFT (see analyzer.head_yaw)."""
    sign = 1.0 if step == "left" else -1.0
    return sign * (yaw - center_yaw) >= LIVENESS_YAW_THRESHOLD and sign * yaw >= LIVENESS_MIN_ABS_YAW
DEADLINE_GRACE_SECONDS = 60 


def _attempt_deadline(a: ExamAttempt) -> "datetime | None":
    if not a.started_at:
        return None
    from datetime import timedelta
    started = a.started_at if a.started_at.tzinfo else a.started_at.replace(tzinfo=timezone.utc)
    deadline = started + timedelta(minutes=a.exam.duration_minutes, seconds=DEADLINE_GRACE_SECONDS)
    if a.exam.scheduled_end:
        # The exam window closing ends every attempt, however late the student joined.
        deadline = min(deadline, as_utc(a.exam.scheduled_end) + timedelta(seconds=DEADLINE_GRACE_SECONDS))
    return deadline


def _get_attempt(attempt_id: AttemptIn, db: DBSession) -> ExamAttempt:
    a = db.get(ExamAttempt, attempt_id)
    if not a:
        raise HTTPException(404, "Attempt not found")
    return a


def _own_attempt(attempt_id: AttemptIn, user: User, db: DBSession) -> ExamAttempt:
    a = _get_attempt(attempt_id, db)
    prof = db.scalar(select(Student).where(Student.user_id == user.id))
    if not prof or a.student_id != prof.id:
        raise HTTPException(403, "Not your attempt")
    return a


@router.get("/{attempt_id}", response_model=AttemptOut)
def get_attempt(attempt_id: AttemptIn, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    a = _get_attempt(attempt_id, db)
    if user.role == Role.student:
        _own_attempt(attempt_id, user, db)
    elif a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Forbidden")
    return a



@router.post("/{attempt_id}/checklist/camera", response_model=AttemptOut)
def check_camera(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
                  user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    a.camera_ok = True
    db.commit()
    db.refresh(a)
    return a


@router.post("/{attempt_id}/checklist/microphone", response_model=AttemptOut)
def check_microphone(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
                      user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    a.microphone_ok = True
    db.commit()
    db.refresh(a)
    return a


@router.post("/{attempt_id}/checklist/screen", response_model=AttemptOut)
def check_screen(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
                  user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    a.screen_ok = True
    db.commit()
    db.refresh(a)
    return a


@router.post("/{attempt_id}/checklist/enroll-face", response_model=FaceEnrollOut)
def enroll_face(attempt_id: AttemptIn, data: FaceEnrollIn, db: DBSession = Depends(get_db),
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
    gallery = student.face_gallery if student and face_scan.is_gallery(student.face_gallery) else None
    reg_embedding = student.registration_face_embedding if student else None
    reference = gallery or reg_embedding

    if reference is None:
        raise HTTPException(
            403,
            "No registered face scan on file for your account. Log out and log in again to "
            "complete the 360° face scan before starting this exam.",
        )

    similarity, threshold = face_scan.match_embedding(reference, avg, "front")
    if similarity < threshold:
        raise HTTPException(
            403,
            "Identity verification failed — we couldn't match your face to your "
            "registered face scan. Please try again: face the camera directly, "
            "make sure your face is well lit and fully visible (no mask, cap or "
            "sunglasses), and keep only yourself in view.",
        )

    a.reference_embedding = reference
    a.identity_verified = True
    a.identity_mismatch_streak = 0
    db.commit()
    return FaceEnrollOut(identity_verified=True, frames_used=len(embeddings),
                          message="Identity verified against your registered photo.")


@router.post("/{attempt_id}/checklist/liveness", response_model=LivenessCheckOut)
def liveness_check(attempt_id: AttemptIn, data: LivenessCheckIn, db: DBSession = Depends(get_db),
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

    ok = abs(yaw_c) <= LIVENESS_STRAIGHT_MAX_YAW and _turned("left", yaw_l, yaw_c) and _turned("right", yaw_r, yaw_c)

    if ok:
        a.liveness_ok = True
        db.commit()
        return LivenessCheckOut(liveness_ok=True, yaw_left=yaw_l, yaw_right=yaw_r,
                                 message="Liveness verified.")
    return LivenessCheckOut(
        liveness_ok=False, yaw_left=yaw_l, yaw_right=yaw_r,
        message="Head turn not detected clearly enough. Please turn your head further to the left and right and do the check again.",
    )


@router.post("/{attempt_id}/checklist/liveness/step", response_model=LivenessStepOut)
def liveness_step(attempt_id: AttemptIn, data: LivenessStepIn, db: DBSession = Depends(get_db),
                  user: User = Depends(require_roles(Role.student))):
    _own_attempt(attempt_id, user, db)

    if data.step not in {"straight", "left", "right"}:
        raise HTTPException(400, "Unknown liveness step")

    frame = decode_b64_jpeg(data.frame)
    if frame is None:
        return LivenessStepOut(step_ok=False, message="Camera image could not be read. Check your camera and do the step again.")
    landmarks = analyzer.detect_face(frame, strict=False)
    if landmarks is None:
        return LivenessStepOut(step_ok=False, message="Face not detected. Keep your face inside the camera frame in good light and do the step again.")
    yaw = analyzer.head_yaw(frame, landmarks)
    if yaw is None:
        return LivenessStepOut(step_ok=False, message="Head position could not be measured. Keep your whole face visible and do the step again.")

    if data.step == "straight":
        step_ok = abs(yaw) <= LIVENESS_STRAIGHT_MAX_YAW
        message = ("Straight-ahead position not detected. Please look straight at the camera and do the step again."
                   if not step_ok else "Straight-ahead position detected.")
    else:
        if not data.center_frame:
            raise HTTPException(400, "A straight-ahead frame is required")
        center = decode_b64_jpeg(data.center_frame)
        center_landmarks = analyzer.detect_face(center, strict=False) if center is not None else None
        center_yaw = analyzer.head_yaw(center, center_landmarks) if center_landmarks is not None else None
        if center_yaw is None:
            return LivenessStepOut(step_ok=False, message="Straight-ahead reference was lost. Please start the liveness check again.")
        step_ok = _turned(data.step, yaw, center_yaw)
        direction = "left" if data.step == "left" else "right"
        message = (f"{direction.title()} position not detected. Please turn your head further to the {direction}, "
                   f"hold it there, and do the step again."
                   if not step_ok else f"{direction.title()} position detected.")

    return LivenessStepOut(step_ok=step_ok, message=message)


@router.post("/{attempt_id}/enter", response_model=AttemptOut)
def enter_exam(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
                user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    exam = a.exam
    if a.status in ("submitted", "graded"):
        raise HTTPException(409, "You have already taken this exam. It can only be attempted once.")
    # Every proctoring check is mandatory. This deliberately ignores exam.security
    # (which could hold stale or tampered values) so no exam can skip a check.
    if not a.camera_ok:
        raise HTTPException(400, "Camera check not completed")
    if not a.microphone_ok:
        raise HTTPException(400, "Microphone check not completed")
    if not a.screen_ok:
        raise HTTPException(400, "Screen share check not completed")
    if not a.identity_verified:
        raise HTTPException(400, "Identity verification not completed")
    if not a.liveness_ok:
        raise HTTPException(400, "Liveness check not completed")

    if a.status not in ("in_progress",):
        check_exam_window(exam)
        a.status = "in_progress"
        a.started_at = datetime.now(timezone.utc)
    if exam.status == "published":
        exam.status = "active"
    db.commit()
    db.refresh(a)
    return a


def _answer_out(ans: Answer, stale: bool = False) -> AnswerOut:
    return AnswerOut(
        question_id=ans.question_id, response=ans.response, is_correct=ans.is_correct,
        marks_awarded=ans.marks_awarded, feedback=ans.feedback,
        requires_manual=bool(ans.requires_manual), graded=ans.graded_at is not None,
        client_seq=int(ans.client_seq or 0), revision=int(ans.revision or 0), stale=stale,
    )


def _validate_response(a: ExamAttempt, q: Question, response: str) -> str:
    if q.type in NON_ANSWERABLE_TYPES:
        raise HTTPException(400, "This item does not accept an answer")
    if q.type in RICH_ANSWER_TYPES:
        if not response.strip():
            return ""
        if not is_document_string(response):
            raise HTTPException(400, "This answer must be saved from the answer editor")
        try:
            return validate_document(response, allowed_components(q))
        except AnswerDocumentError as exc:
            raise HTTPException(400, str(exc))
    if len(response) > MAX_PLAIN_RESPONSE:
        raise HTTPException(400, "Answer is too long")
    if is_document_string(response):
        raise HTTPException(400, "This question type does not accept rich answers")
    if q.type == "file_upload" and response.strip():
        files = load_json(response, None)
        max_files = int((q.settings or {}).get("max_files", 1))
        if not isinstance(files, list) or len(files) > max_files:
            raise HTTPException(400, f"You can attach at most {max_files} file(s)")
        prefix = f"{settings.MEDIA_URL}/answers/{encode_ref(ATTEMPT, a.id)}/{q.id}/"
        for f in files:
            if not isinstance(f, dict) or not str(f.get("url", "")).startswith(prefix):
                raise HTTPException(400, "Invalid file reference, upload the file again")
    return response


@router.post("/{attempt_id}/answer", response_model=AnswerOut)
def submit_answer(attempt_id: AttemptIn, data: AnswerIn, db: DBSession = Depends(get_db),
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
    response = _validate_response(a, q, data.response)

    def _locked_answer():
        return db.scalar(
            select(Answer)
            .where(Answer.attempt_id == a.id, Answer.question_id == q.id)
            .with_for_update()
        )

    def _apply(ans: Answer) -> bool:
        if data.client_seq is not None and ans.client_seq and data.client_seq <= ans.client_seq:
            return False
        ans.response = response
        if data.client_seq is not None:
            ans.client_seq = data.client_seq
        ans.revision = int(ans.revision or 0) + 1
        return True

    ans = _locked_answer()
    created = ans is None
    if created:
        ans = Answer(attempt_id=a.id, question_id=q.id, client_seq=0, revision=0)
        db.add(ans)
    applied = _apply(ans)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        ans = _locked_answer()
        applied = _apply(ans)
        db.commit()
    db.refresh(ans)
    return _answer_out(ans, stale=not applied)


@router.post("/{attempt_id}/submit", response_model=SubmitExamOut)
def submit_exam(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
                 user: User = Depends(require_roles(Role.student))):
    a = _own_attempt(attempt_id, user, db)
    if a.status != "in_progress":
        raise HTTPException(400, "Attempt is not in progress")

    existing = {
        ans.question_id: ans
        for ans in db.scalars(select(Answer).where(Answer.attempt_id == a.id)).all()
    }
    ungraded = 0
    auto_score = 0.0
    for q in a.exam.questions:
        if q.type in NON_ANSWERABLE_TYPES:
            continue
        ans = existing.get(q.id)
        if not ans:
            ans = Answer(attempt_id=a.id, question_id=q.id, response="")
            db.add(ans)
        result = grade(q, ans.response)
        ans.requires_manual = result.requires_manual
        if result.requires_manual:
            ans.is_correct = None
            ans.marks_awarded = 0.0
            ungraded += 1
        else:
            ans.is_correct = result.is_correct
            ans.marks_awarded = round(float(q.marks) * result.fraction, 2)
            auto_score += ans.marks_awarded

    auto_score = round(auto_score, 2)
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
def list_exam_attempts(exam_id: ExamIn, db: DBSession = Depends(get_db),
                        user: User = Depends(require_roles(Role.teacher, Role.admin))):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    rows = db.scalars(
        select(ExamAttempt)
        .where(ExamAttempt.exam_id == exam_id)
        .options(selectinload(ExamAttempt.student).selectinload(Student.user))
    ).all()
    out = []
    for a in rows:
        item = AttemptOut.model_validate(a)
        item.student_name = a.student.user.name
        item.student_code = a.student.student_id
        item.student_email = a.student.user.email
        out.append(item)
    return out


@router.get("/{attempt_id}/risk")
def get_attempt_risk(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
                      user: User = Depends(require_roles(Role.teacher, Role.admin))):
    a = _get_attempt(attempt_id, db)
    if a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    risk = compute_risk(attempt_id, db)
    risk["attempt_id"] = encode_ref(ATTEMPT, attempt_id)
    return risk


@router.get("/exam/{exam_id}/risk")
def get_exam_risk(exam_id: ExamIn, db: DBSession = Depends(get_db),
                   user: User = Depends(require_roles(Role.teacher, Role.admin))):
    exam = db.get(ExamSession, exam_id)
    if not exam:
        raise HTTPException(404, "Exam not found")
    if exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    attempts = db.scalars(
        select(ExamAttempt)
        .where(ExamAttempt.exam_id == exam_id)
        .options(selectinload(ExamAttempt.student).selectinload(Student.user))
    ).all()
    risks = compute_risk_bulk([a.id for a in attempts], db)
    out = []
    for a in attempts:
        risk = risks[a.id]
        risk["attempt_id"] = encode_ref(ATTEMPT, a.id)
        risk["student_id"] = a.student.student_id
        risk["student_name"] = a.student.user.name
        out.append(risk)
    return out


@router.get("/{attempt_id}/identity-log")
def get_identity_log(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
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
def get_attempt_report(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
                        user: User = Depends(require_roles(Role.teacher, Role.admin))):
    a = _get_attempt(attempt_id, db)
    if a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Forbidden")

    pdf_bytes = build_attempt_report(a, db)
    filename = f"exam-report-attempt-{a.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{attempt_id}/answers", response_model=list[AnswerOut])
def list_attempt_answers(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    a = _get_attempt(attempt_id, db)
    if user.role == Role.student:
        _own_attempt(attempt_id, user, db)
    elif a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Forbidden")
    rows = db.scalars(select(Answer).where(Answer.attempt_id == attempt_id)).all()
    return [_answer_out(r) for r in rows]


@router.get("/{attempt_id}/questions", response_model=list[QuestionAnswerKeyOut])
def list_submitted_questions(attempt_id: AttemptIn, db: DBSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    a = _get_attempt(attempt_id, db)
    if user.role == Role.student:
        _own_attempt(attempt_id, user, db)
    elif a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Forbidden")
    if a.status not in ("submitted", "graded"):
        raise HTTPException(403, "Question answer keys are available after submission")
    return [
        QuestionAnswerKeyOut(
            id=q.id, type=q.type, text=q.text, options=q.options, marks=q.marks,
            order=q.order, media=q.media or [], settings=q.settings or {},
            correct_answer=q.correct_answer, answer_key=q.answer_key,
        )
        for q in a.exam.questions
    ]


def _apply_grade(a: ExamAttempt, question_id: int, data: GradeShortAnswerIn,
                 user: User, db: DBSession) -> Answer:
    q = db.get(Question, question_id)
    if not q or q.exam_id != a.exam_id:
        raise HTTPException(404, "Question not found in this exam")
    if q.type in NON_ANSWERABLE_TYPES:
        raise HTTPException(400, "This item is not graded")
    ans = db.scalar(select(Answer).where(Answer.attempt_id == a.id, Answer.question_id == question_id))
    if not ans:
        ans = Answer(attempt_id=a.id, question_id=q.id, response="", requires_manual=True)
        db.add(ans)
    if data.marks_awarded > float(q.marks) + 1e-9:
        raise HTTPException(
            400,
            f"Marks cannot be more than this question's total of {q.marks}.",
        )
    awarded = round(float(data.marks_awarded), 2)
    ans.marks_awarded = awarded
    ans.feedback = data.feedback
    ans.graded_by = user.id
    ans.graded_at = datetime.now(timezone.utc)
    if not ans.requires_manual:
        ans.is_correct = awarded >= float(q.marks) - 1e-9
    db.flush()
    return ans


def _recompute_attempt_scores(a: ExamAttempt, db: DBSession) -> None:
    all_answers = db.scalars(select(Answer).where(Answer.attempt_id == a.id)).all()
    manual = [x for x in all_answers if x.requires_manual]
    auto = [x for x in all_answers if not x.requires_manual]
    a.auto_score = round(sum(x.marks_awarded for x in auto), 2)
    a.manual_score = round(sum(x.marks_awarded for x in manual), 2)
    if all(x.graded_at is not None for x in manual):
        a.final_score = round(a.auto_score + a.manual_score, 2)
        a.status = "graded"
    else:
        a.final_score = None
        a.status = "submitted"


def _gradable_attempt(attempt_id: AttemptIn, user: User, db: DBSession) -> ExamAttempt:
    a = _get_attempt(attempt_id, db)
    if a.exam.course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "Not your exam")
    if a.status not in ("submitted", "graded"):
        raise HTTPException(400, "This attempt has not been submitted yet")
    return a


@router.post("/{attempt_id}/grade/{question_id}", response_model=AnswerOut)
def grade_short_answer(attempt_id: AttemptIn, question_id: int, data: GradeShortAnswerIn,
                        db: DBSession = Depends(get_db),
                        user: User = Depends(require_roles(Role.teacher, Role.admin))):
    a = _gradable_attempt(attempt_id, user, db)
    ans = _apply_grade(a, question_id, data, user, db)
    _recompute_attempt_scores(a, db)
    db.commit()
    db.refresh(ans)
    return _answer_out(ans)


@router.post("/{attempt_id}/grade", response_model=list[AnswerOut])
def grade_bulk(attempt_id: AttemptIn, data: BulkGradeIn, db: DBSession = Depends(get_db),
               user: User = Depends(require_roles(Role.teacher, Role.admin))):
    """Save marks/feedback for many questions of one attempt in a single atomic call."""
    a = _gradable_attempt(attempt_id, user, db)
    seen: set[int] = set()
    saved: list[Answer] = []
    try:
        for item in data.grades:
            if item.question_id in seen:
                raise HTTPException(400, "Duplicate question in grade list")
            seen.add(item.question_id)
            saved.append(_apply_grade(a, item.question_id, item, user, db))
        _recompute_attempt_scores(a, db)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    for ans in saved:
        db.refresh(ans)
    return [_answer_out(x) for x in saved]