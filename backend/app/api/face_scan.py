
from __future__ import annotations

import cv2
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DBSession

from app.ai.face_scan import FaceScanSession, ScanConfig, ScanResult, ScanStore
from app.ai.face_scan_vision import models_ready, observe_frame
from app.ai.utils import decode_b64_jpeg
from app.core.config import settings
from app.core.security import (
    create_access_token, create_purpose_token, create_refresh_token, decode_token,
)
from app.db.session import get_db
from app.models.student import Student
from app.models.user import Role, User
from app.schemas.auth import TokenOut

router = APIRouter(prefix="/auth/face-scan", tags=["face-scan"])

store = ScanStore(max_sessions=settings.FACE_SCAN_MAX_SESSIONS)

FACE_PENDING = "face_pending"        
FACE_TICKET = "face_scan_ticket"     
MAX_FRAME_WIDTH = 640


class StartIn(BaseModel):
    purpose: Literal["register", "login"]
    scan_token: str | None = None


class FrameIn(BaseModel):
    session_id: str = Field(min_length=10, max_length=100)
    image: str = Field(min_length=100, max_length=700_000)   


class CompleteIn(BaseModel):
    session_id: str = Field(min_length=10, max_length=100)


def pending_token_for(user: User) -> str:
    return create_purpose_token(str(user.id), user.role.value, settings.FACE_SCAN_TOKEN_MINUTES, FACE_PENDING)


def consume_register_scan(ticket: str | None) -> ScanResult:
    if not ticket:
        raise HTTPException(400, "Please complete the 360° face scan before registering.")
    try:
        payload = decode_token(ticket)
        if payload.get("type") != FACE_TICKET:
            raise ValueError("wrong token type")
        sid = payload["sub"]
    except (ValueError, KeyError):
        raise HTTPException(400, "Your face scan has expired. Please scan again.")
    rec = store.consume(sid, "register")
    if rec is None or rec.engine.result is None:
        raise HTTPException(400, "Your face scan is no longer valid. Please scan again.")
    return rec.engine.result


def _require_models():
    if not models_ready():
        raise HTTPException(503, "Face verification service is unavailable on the server right now.")


def _tokens(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(str(user.id), user.role.value),
        refresh_token=create_refresh_token(str(user.id), user.role.value),
        role=user.role, name=user.name,
    )


@router.post("/start")
def start(data: StartIn, db: DBSession = Depends(get_db)):
    _require_models()
    cfg = ScanConfig.from_settings(settings)

    if data.purpose == "register":
        engine = FaceScanSession(mode="enroll", cfg=cfg)
        rec = store.create("register", engine)
    else:
        try:
            payload = decode_token(data.scan_token or "")
            if payload.get("type") != FACE_PENDING:
                raise ValueError("wrong token type")
            user = db.get(User, int(payload["sub"]))
        except (ValueError, KeyError):
            raise HTTPException(401, "Your login session expired. Please log in again.")
        if not user or user.role != Role.student or not user.student_profile:
            raise HTTPException(403, "Face scan is only for student accounts.")

        wait = store.locked_for(user.id, settings.FACE_SCAN_MAX_FAILED_SESSIONS,
                                settings.FACE_SCAN_LOCKOUT_MINUTES * 60)
        if wait > 0:
            raise HTTPException(429, f"Too many failed face scans. Try again in {int(wait // 60) + 1} minute(s).")

        prof: Student = user.student_profile
        if prof.face_scan_templates:
            engine = FaceScanSession(mode="verify", cfg=cfg, templates=prof.face_scan_templates)
        elif prof.registration_face_embedding:
            engine = FaceScanSession(mode="upgrade", cfg=cfg, reference=prof.registration_face_embedding)
        elif settings.FACE_SCAN_ENROLL_ON_FIRST_LOGIN:
            engine = FaceScanSession(mode="enroll", cfg=cfg)
        else:
            raise HTTPException(403, "No face data is registered for your account. Contact your administrator.")
        rec = store.create("login", engine, user_id=user.id)

    if rec is None:
        raise HTTPException(503, "The face scan service is busy. Please try again in a moment.")
    return {"session_id": rec.id, "mode": rec.engine.mode, "frame": rec.engine.snapshot()}


@router.post("/frame")
def frame(data: FrameIn):
    rec = store.get(data.session_id)
    if rec is None:
        raise HTTPException(404, "The scan session expired. Please start again.")
    img = decode_b64_jpeg(data.image)
    if img is None:
        raise HTTPException(400, "Could not read the camera frame.")
    h, w = img.shape[:2]
    if w > MAX_FRAME_WIDTH:
        img = cv2.resize(img, (MAX_FRAME_WIDTH, int(h * MAX_FRAME_WIDTH / w)), interpolation=cv2.INTER_AREA)
    jpeg = data.image.split(",", 1)[1] if "," in data.image[:60] else data.image

    with rec.lock:
        if rec.engine.phase != "running":
            return rec.engine.snapshot(rec.engine.fail_reason or "done", rec.engine.fail_message or "Scan finished.")
        out = rec.engine.process(observe_frame(img, jpeg))
        if out["status"] == "failed" and rec.purpose == "login" and rec.user_id and not rec.failure_counted:
            rec.failure_counted = True
            store.record_failure(rec.user_id)
    return out


@router.post("/complete")
def complete(data: CompleteIn, db: DBSession = Depends(get_db)):
    rec = store.get(data.session_id)
    if rec is None:
        raise HTTPException(404, "The scan session expired. Please start again.")
    if rec.engine.phase != "passed" or rec.engine.result is None:
        raise HTTPException(409, "The face scan is not complete.")

    if rec.purpose == "register":
        minutes = settings.FACE_SCAN_TICKET_MINUTES
        ticket = create_purpose_token(rec.id, "student", minutes, FACE_TICKET)
        return {"scan_ticket": ticket, "expires_in": minutes * 60}

    rec = store.consume(data.session_id, "login")
    if rec is None:
        raise HTTPException(409, "This scan was already used. Please log in again.")
    user = db.get(User, rec.user_id)
    prof = user.student_profile if user else None
    if not user or not prof:
        raise HTTPException(401, "Account not found.")

    res = rec.engine.result
    mode = rec.engine.mode
    if mode == "enroll" and (prof.face_scan_templates or prof.registration_face_embedding):
        raise HTTPException(409, "Your face data changed in the meantime. Please log in again.")
    if mode in ("upgrade", "enroll"):
        prof.face_scan_templates = res.templates
        if mode == "enroll":
            prof.registration_face_embedding = res.registration_embedding
            prof.registration_face_image = res.best_front_jpeg
        db.commit()
    store.clear_failures(user.id)
    return _tokens(user)
