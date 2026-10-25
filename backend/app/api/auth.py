from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select
from fastapi import status as http_status
from app.db.session import get_db
from app.models.user import User, Role
from app.models.student import Student
from app.schemas.auth import RegisterIn, LoginIn, LoginOut, TokenOut, RefreshIn, MeOut
from app.core.security import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token,
)
from app.api.deps import get_current_user
from app.ai.analyzer import analyzer
from app.ai.face_id import face_identifier
from app.ai.utils import decode_b64_jpeg
from app.api.face_scan import consume_register_scan, pending_token_for
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(str(user.id), user.role.value),
        refresh_token=create_refresh_token(str(user.id), user.role.value),
        role=user.role,
        name=user.name,
    )


@router.post("/register", response_model=TokenOut, status_code=201)
def register(data: RegisterIn, db: DBSession = Depends(get_db)):
    exists = db.scalar(select(User).where(User.email == data.email))
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    reg_embedding = None
    reg_image = None
    scan_templates = None
    if data.role == Role.student:
        if settings.FACE_SCAN_REQUIRED_FOR_REGISTER:
            scan = consume_register_scan(data.face_scan_ticket)
            reg_embedding = scan.registration_embedding
            reg_image = scan.best_front_jpeg
            scan_templates = scan.templates
        else:
            if not data.reference_image:
                raise HTTPException(
                    http_status.HTTP_400_BAD_REQUEST,
                    "A confirmed face photo is required to register a student account.",
                )
            if not analyzer.ready or not face_identifier.ready:
                raise HTTPException(
                    http_status.HTTP_503_SERVICE_UNAVAILABLE,
                    "Face verification service unavailable on the server right now.",
                )

            ref_frame = decode_b64_jpeg(data.reference_image)
            if ref_frame is None:
                raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "Could not read the confirmed photo. Please retake it.")
            ref_landmarks = analyzer.detect_face(ref_frame, strict=True)
            if ref_landmarks is None:
                raise HTTPException(
                    http_status.HTTP_400_BAD_REQUEST,
                    "Could not clearly detect a single face in your photo. Make sure only "
                    "your face is visible with good lighting, then retake it.",
                )
            visible, _, _reason = face_identifier.face_visibility_quality(ref_frame, ref_landmarks)
            if not visible:
                raise HTTPException(
                    http_status.HTTP_400_BAD_REQUEST,
                    "Your face isn't clearly visible in this photo (too covered, dark, or "
                    "blurry). Please retake it with your full face visible in good lighting.",
                )

            embeddings = []
            ref_embedding_single = face_identifier.embed(ref_frame, ref_landmarks)
            if ref_embedding_single is not None:
                embeddings.append(ref_embedding_single)
            for b64 in (data.face_frames or []):
                frame = decode_b64_jpeg(b64)
                if frame is None:
                    continue
                lm = analyzer.detect_face(frame, strict=True)
                if lm is None:
                    continue
                emb = face_identifier.embed(frame, lm)
                if emb is not None:
                    embeddings.append(emb)
            if not embeddings:
                raise HTTPException(
                    http_status.HTTP_400_BAD_REQUEST,
                    "Could not process your photo. Make sure only your face is visible "
                    "with good lighting, then try again.",
                )
            reg_embedding = face_identifier.average_embedding(embeddings)
            reg_image = data.reference_image

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
            registration_face_embedding=reg_embedding,
            registration_face_image=reg_image,
            face_scan_templates=scan_templates,
        ))
    db.commit()
    db.refresh(user)
    return _tokens(user)


@router.post("/login", response_model=LoginOut)
def login(data: LoginIn, db: DBSession = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email))
    if not user or not verify_password(data.password, user.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if user.role == Role.student and settings.FACE_SCAN_REQUIRED_FOR_LOGIN:
        return LoginOut(role=user.role, name=user.name, requires_face_scan=True,
                        scan_token=pending_token_for(user))
    return LoginOut(**_tokens(user).model_dump())


@router.post("/login-form", response_model=TokenOut)
def login_form(form: OAuth2PasswordRequestForm = Depends(), db: DBSession = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == form.username))
    if not user or not verify_password(form.password, user.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if user.role == Role.student and settings.FACE_SCAN_REQUIRED_FOR_LOGIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Students must log in through the app (face scan required).")
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
    )
