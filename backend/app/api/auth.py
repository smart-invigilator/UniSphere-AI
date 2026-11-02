import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select
from app.db.session import get_db
from app.models.user import User, Role
from app.models.student import Student
from app.schemas.auth import (
    RegisterIn, LoginIn, LoginOut, TokenOut, RefreshIn, MeOut, FaceLoginIn,
    ScanFrameCheckIn, ScanFrameCheckOut,
)
from app.core.config import settings
from app.core.ratelimit import TokenBucketLimiter
from app.core.security import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token, _create_token,
)
from app.api.deps import get_current_user
from app.ai.face_id import face_identifier
from app.ai.utils import decode_b64_jpeg
from app.ai import face_scan

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

scan_limiter = TokenBucketLimiter(rate_per_second=settings.FACE_SCAN_FRAMES_PER_SECOND, burst=16)
submit_limiter = TokenBucketLimiter(rate_per_second=0.2, burst=5)
login_limiter = TokenBucketLimiter(rate_per_second=0.5, burst=10)


def _tokens(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(str(user.id), user.role.value),
        refresh_token=create_refresh_token(str(user.id), user.role.value),
        role=user.role,
        name=user.name,
    )


def _login_tokens(user: User) -> LoginOut:
    t = _tokens(user)
    return LoginOut(access_token=t.access_token, refresh_token=t.refresh_token, role=user.role, name=user.name)


def _face_login_required(user: User) -> bool:
    return settings.FACE_LOGIN_REQUIRED and user.role == Role.student


def _require_scan_service() -> None:
    if not face_scan.scan_ready():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Face verification service is unavailable on the server right now. "
            "Check that the face models are installed (see README).",
        )


def _scan_or_400(frames) -> "face_scan.ScanOutcome":
    outcome = face_scan.process_scan(frames)
    if outcome.missing:
        views = ", ".join(face_scan.GROUP_TEXT[m] for m in outcome.missing)
        hint = f" ({outcome.first_error})" if outcome.first_error else ""
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"The face scan is incomplete — we still need a view of you {views}{hint}. Please scan again.",
        )
    ok, reason = face_scan.check_consistency(outcome.bins)
    if not ok:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{reason}. Make sure only you are in front of the camera and scan again.",
        )
    return outcome


@router.post("/face/scan-frame", response_model=ScanFrameCheckOut)
def check_scan_frame(data: ScanFrameCheckIn, request: Request):
    scan_limiter.check(request, "scan")
    _require_scan_service()
    res = face_scan.analyze_frame(decode_b64_jpeg(data.image), need_embedding=False)
    return ScanFrameCheckOut(ok=res.ok, kind=res.kind, label=res.label, yaw=res.yaw, message=res.message)


@router.post("/register", response_model=TokenOut, status_code=201)
def register(data: RegisterIn, request: Request, db: DBSession = Depends(get_db)):
    exists = db.scalar(select(User).where(User.email == data.email))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    gallery = None
    front_embedding = None
    front_image = None
    if data.role == Role.student:
        if not data.face_scan:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "A complete 360° face scan is required to register a student account.",
            )
        submit_limiter.check(request, "register-scan")
        _require_scan_service()
        outcome = _scan_or_400(data.face_scan)
        gallery = face_scan.build_gallery(outcome.bins)
        front_embedding = face_scan.front_average(outcome.bins)
        front_image = outcome.front_image

    user = User(
        name=data.name, email=data.email,
        password=hash_password(data.password), role=data.role,
    )
    db.add(user)
    db.flush()

    if data.role == Role.student:
        sid = data.student_id or f"STU-{1000 + user.id}"
        db.add(Student(
            user_id=user.id, student_id=sid,
            department=data.department or "", session_label="2024-2025",
            registration_face_embedding=front_embedding,
            registration_face_image=front_image,
            face_gallery=gallery,
            face_scan_updated_at=datetime.now(timezone.utc) if gallery else None,
        ))
    db.commit()
    db.refresh(user)
    return _tokens(user)


@router.post("/login", response_model=LoginOut)
def login(data: LoginIn, request: Request, db: DBSession = Depends(get_db)):
    login_limiter.check(request, "login")
    user = db.scalar(select(User).where(User.email == data.email))
    if not user or not verify_password(data.password, user.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not _face_login_required(user):
        return _login_tokens(user)
    _require_scan_service()
    prof = user.student_profile
    face_token = _create_token(
        str(user.id), user.role.value, timedelta(minutes=settings.FACE_LOGIN_TOKEN_MINUTES), "face",
    )
    return LoginOut(
        role=user.role, name=user.name, face_required=True, face_token=face_token,
        face_enrolled=bool(prof and face_scan.is_gallery(prof.face_gallery)),
    )


@router.post("/login/face", response_model=TokenOut)
def login_face(data: FaceLoginIn, request: Request, db: DBSession = Depends(get_db)):
    submit_limiter.check(request, "login-face")
    try:
        payload = decode_token(data.face_token)
        if payload.get("type") != "face":
            raise ValueError("wrong token type")
        user = db.get(User, int(payload["sub"]))
    except (ValueError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your login session expired. Enter your password again.")
    if not user or user.role != Role.student or not user.student_profile:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your login session expired. Enter your password again.")

    _require_scan_service()
    prof = user.student_profile
    outcome = _scan_or_400(data.face_scan)

    if face_scan.is_gallery(prof.face_gallery):
        result = face_scan.verify_scan(prof.face_gallery, outcome.bins)
        if not result.ok:
            logger.warning("face login rejected for user %s: %s", user.id, result.failed_views)
            raise HTTPException(status.HTTP_403_FORBIDDEN, result.message + " Access denied.")
        return _tokens(user)

    front = face_scan.front_average(outcome.bins)
    if prof.registration_face_embedding is not None:
        sim = face_identifier.cosine_similarity(prof.registration_face_embedding, front)
        if sim < settings.FACE_MATCH_THRESHOLD:
            logger.warning("face enrollment upgrade rejected for user %s sim=%.3f", user.id, sim)
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "This face doesn't match the photo registered on your account. Access denied.",
            )
    prof.face_gallery = face_scan.build_gallery(outcome.bins)
    prof.face_scan_updated_at = datetime.now(timezone.utc)
    if prof.registration_face_embedding is None:
        prof.registration_face_embedding = front
    if not prof.registration_face_image and outcome.front_image:
        prof.registration_face_image = outcome.front_image
    db.commit()
    return _tokens(user)


@router.post("/login-form", response_model=TokenOut)
def login_form(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: DBSession = Depends(get_db)):
    login_limiter.check(request, "login")
    user = db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if _face_login_required(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Students must log in through the app with a face scan.")
    return _tokens(user)


@router.post("/refresh", response_model=TokenOut)
def refresh(data: RefreshIn, db: DBSession = Depends(get_db)):
    try:
        payload = decode_token(data.refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError()
        user = db.get(User, int(payload["sub"]))
    except (ValueError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return _tokens(user)


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)):
    prof = user.student_profile
    return MeOut(
        id=user.id, name=user.name, email=user.email, role=user.role,
        student_id=prof.student_id if prof else None,
        department=prof.department if prof else None,
        face_scan_enrolled=bool(prof and face_scan.is_gallery(prof.face_gallery)),
    )