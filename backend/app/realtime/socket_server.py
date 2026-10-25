
import base64
import time
import asyncio
import socketio

from app.core.security import decode_token
from app.realtime.manager import manager
from app.ai.analyzer import analyzer
from app.ai.audio import audio_analyzer
from app.ai.face_id import face_identifier
from app.ai.utils import decode_b64_jpeg
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.user import User
from app.models.student import Student
from app.models.exam import ExamSession
from app.models.attempt import ExamAttempt
from app.models.alert import Alert
from app.models.monitoring import AttentionScore
from app.models.identity_log import IdentityCheckLog

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

_frame_counter: dict[str, int] = {}

CLIENT_VIOLATION_TYPES = {
    "tab_switch": ("Tab Switched", "medium", 0.9),
    "window_blur": ("Browser Window Unfocused", "medium", 0.85),
    "fullscreen_exit": ("Fullscreen Exited", "high", 0.95),
    "copy": ("Copy Detected", "medium", 0.8),
    "paste": ("Paste Detected", "medium", 0.8),
    "multiple_displays": ("Multiple Displays Detected", "medium", 0.85),
    "camera_stopped": ("Camera Stopped", "high", 1.0),
    "microphone_stopped": ("Microphone Stopped", "high", 1.0),
    "screen_share_stopped": ("Screen Sharing Stopped", "high", 1.0),
}
CLIENT_VIOLATION_COOLDOWN_SECONDS = 3.0

IDENTITY_LOG_SAMPLE_EVERY = 4
FACE_OCCLUSION_ALERT_COOLDOWN_SECONDS = 20.0


def _room(exam_id) -> str:
    return f"exam:{exam_id}:dashboard"


@sio.event
async def connect(sid, environ):
    pass  


@sio.event
async def disconnect(sid):
    s = manager.disconnect(sid)
    if s:
        await sio.emit("students:tick", manager.snapshot(s.exam_id), room=_room(s.exam_id))


@sio.on("dashboard:join")
async def dashboard_join(sid, data):
    token = (data or {}).get("token", "")
    exam_id = (data or {}).get("exam_id")
    if not exam_id:
        return {"ok": False, "error": "exam_id required"}
    try:
        payload = decode_token(token)
        if payload.get("role") not in ("teacher", "admin"):
            return {"ok": False, "error": "forbidden"}
        user_id = int(payload["sub"])
    except Exception:
        return {"ok": False, "error": "invalid token"}

    db = SessionLocal()
    try:
        exam = db.get(ExamSession, int(exam_id))
        if not exam:
            return {"ok": False, "error": "exam not found"}
        if exam.course.teacher_id != user_id:
            user = db.get(User, user_id)
            if not user or user.role.value != "admin":
                return {"ok": False, "error": "forbidden"}
    finally:
        db.close()

    await sio.enter_room(sid, _room(exam_id))
    await sio.emit("students:init", manager.snapshot(int(exam_id)), to=sid)
    return {"ok": True}


@sio.on("student:join")
async def student_join(sid, data):
    token = (data or {}).get("token", "")
    attempt_id = (data or {}).get("attempt_id")
    if not attempt_id:
        return {"ok": False, "error": "attempt_id required"}
    try:
        payload = decode_token(token)
        user_id = int(payload["sub"])
    except Exception:
        return {"ok": False, "error": "invalid token"}

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        attempt = db.get(ExamAttempt, int(attempt_id))
        if not user or not attempt:
            return {"ok": False, "error": "not found"}
        prof = db.query(Student).filter(Student.user_id == user_id).first()
        if not prof or attempt.student_id != prof.id:
            return {"ok": False, "error": "forbidden"}
        if attempt.status != "in_progress":
            return {"ok": False, "error": "attempt is not in progress"}

        live = manager.register(
            attempt_id=attempt.id, exam_id=attempt.exam_id, student_id=prof.student_id,
            name=user.name, db_id=prof.id, department=prof.department,
            reference_embedding=attempt.reference_embedding,
        )
        manager.connect(attempt.id, sid)
    finally:
        db.close()

    await sio.emit("students:tick", manager.snapshot(live.exam_id), room=_room(live.exam_id))
    return {
        "ok": True,
        "studentId": live.student_id,
        "examId": live.exam_id,
        "identity": live.to_dict()["identity"],
    }


@sio.on("heartbeat")
async def heartbeat(sid, data):
    s = manager.by_sid(sid)
    if s:
        s.last_activity = time.time()


@sio.on("client:violation")
async def client_violation(sid, data):
    s = manager.by_sid(sid)
    if not s:
        return
    kind = (data or {}).get("type")
    entry = CLIENT_VIOLATION_TYPES.get(kind)
    if not entry:
        return  

    now = time.time()
    last = s.last_client_violation.get(kind, 0)
    if now - last < CLIENT_VIOLATION_COOLDOWN_SECONDS:
        return
    s.last_client_violation[kind] = now

    alert_type, severity, confidence = entry
    s.alert_count += 1
    s.status = "alert"
    fired_alert = _persist_alert(s, {"alert_type": alert_type, "severity": severity, "confidence": confidence, "ts": now})
    await sio.emit("alert", {"alert": fired_alert, "student": s.to_dict()}, room=_room(s.exam_id))
    await sio.emit("students:tick", manager.snapshot(s.exam_id), room=_room(s.exam_id))


@sio.on("audio:level")
async def audio_level(sid, data):
    s = manager.by_sid(sid)
    if not s:
        return
    level = float((data or {}).get("level", 0) or 0)
    now = time.time()
    s.audio_level = round(level, 3)

    alert = audio_analyzer.analyze(level, s, now=now)
    if alert is not None:
        s.alert_count += 1
        s.status = "alert"
        fired_alert = _persist_alert(s, alert)
        await sio.emit("alert", {"alert": fired_alert, "student": s.to_dict()}, room=_room(s.exam_id))
        await sio.emit("students:tick", manager.snapshot(s.exam_id), room=_room(s.exam_id))


@sio.on("frame:screen")
async def frame_screen(sid, data):
    s = manager.by_sid(sid)
    if not s:
        return
    await sio.emit("frame:screen",
                   {"studentId": s.student_id, "image": (data or {}).get("image", "")},
                   room=_room(s.exam_id))


@sio.on("frame:webcam")
async def frame_webcam(sid, data):
    s = manager.by_sid(sid)
    if not s:
        return
    s.last_activity = time.time()

    await sio.emit("frame:webcam",
                   {"studentId": s.student_id, "image": (data or {}).get("image", "")},
                   room=_room(s.exam_id))

    n = _frame_counter.get(str(s.attempt_id), 0) + 1
    _frame_counter[str(s.attempt_id)] = n
    if n % settings.FRAME_SAMPLE_RATE != 0:
        return

    frame = decode_b64_jpeg((data or {}).get("image", ""))
    if frame is None:
        return

    result = await asyncio.to_thread(analyzer.analyze, frame, s.ai_state)
    metrics = result["metrics"]
    s.attention = metrics.get("attention", s.attention)
    s.last_metrics = metrics

    if n % (settings.FRAME_SAMPLE_RATE * 10) == 0:
        _persist_attention(s.db_id, s.attempt_id, s.attention)

    alerts = list(result["alerts"])

    if s.reference_embedding and face_identifier.ready:
        landmarks = result.get("landmarks")
        if landmarks is None:
            s.face_missing_streak += 1
            s.face_occlusion_streak = 0
            if s.face_missing_streak >= settings.FACE_MISSING_FRAMES_FOR_UNVERIFIED:
                s.identity_status = "no_face"
                s.last_similarity = None
        else:
            s.face_missing_streak = 0
            visible, _, reason = await asyncio.to_thread(
                face_identifier.face_visibility_quality, frame, landmarks
            )
            if not visible:
                s.face_occlusion_streak += 1
                if s.face_occlusion_streak >= settings.FACE_QUALITY_STREAK_FRAMES:
                    s.identity_status = "obstructed"
                    s.last_similarity = None
                    if time.time() - s.last_occlusion_alert > FACE_OCCLUSION_ALERT_COOLDOWN_SECONDS:
                        alerts.append({
                            "alert_type": "Face Covered",
                            "severity": "high",
                            "confidence": 0.85,
                            "ts": time.time(),
                        })
                        s.last_occlusion_alert = time.time()
            else:
                s.face_occlusion_streak = 0
                just_reappeared = s.identity_status in ("no_face", "obstructed", "verifying")
                if just_reappeared:
                    s.identity_status = "verifying"
                    s.last_similarity = None
                s.face_check_counter += 1
                due = just_reappeared or s.face_check_counter % settings.FACE_CHECK_EVERY == 0
                if due:
                    sim = await asyncio.to_thread(
                        face_identifier.compare, s.reference_embedding, frame, landmarks
                    )
                    if sim is not None:
                        s.last_similarity = round(sim, 3)
                        is_match = sim >= settings.FACE_MATCH_THRESHOLD
                        if not is_match:
                            s.mismatch_streak += 1
                            s.identity_status = "mismatch"
                        else:
                            s.mismatch_streak = 0
                            s.identity_status = "verified"

                        s.identity_log_counter += 1
                        if not is_match or s.identity_log_counter % IDENTITY_LOG_SAMPLE_EVERY == 0:
                            _persist_identity_log(s.attempt_id, sim, is_match)

                        if s.mismatch_streak == settings.FACE_MISMATCH_STREAK:
                            alerts.append({
                                "alert_type": "Different Person Detected",
                                "severity": "high",
                                "confidence": round(1.0 - sim, 3),
                                "ts": time.time(),
                            })

    image_b64 = (data or {}).get("image", "")
    for a in alerts:
        s.alert_count += 1
        s.status = "alert"
        fired_alert = _persist_alert(s, a, screenshot=image_b64)
        await sio.emit("alert", {"alert": fired_alert, "student": s.to_dict()}, room=_room(s.exam_id))

    if not alerts and s.status == "alert":
        if (s.ai_state.away_frames == 0 and s.ai_state.missing_frames == 0
                and s.mismatch_streak == 0 and s.face_occlusion_streak == 0
                and metrics.get("faces", 1) <= 1 and not metrics.get("objects")):
            s.status = "normal"

    if s.sid:
        await sio.emit("identity:status", s.to_dict()["identity"], to=s.sid)
    await sio.emit("students:tick", manager.snapshot(s.exam_id), room=_room(s.exam_id))


def _persist_alert(s, a, screenshot: str | None = None) -> dict:
    db = SessionLocal()
    try:
        row = Alert(
            student_id=s.db_id, attempt_id=s.attempt_id, alert_type=a["alert_type"],
            severity=a["severity"], confidence=a["confidence"], screenshot=screenshot,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {
            "id": f"ALT-{row.id:06d}", "studentId": s.student_id,
            "studentName": s.name, "type": a["alert_type"],
            "severity": a["severity"], "confidence": a["confidence"],
            "timestamp": int(row.timestamp.timestamp() * 1000),
            "reviewed": False, "notes": "",
        }
    finally:
        db.close()


def _persist_identity_log(attempt_id, similarity, is_match):
    db = SessionLocal()
    try:
        db.add(IdentityCheckLog(attempt_id=attempt_id, similarity=float(similarity), is_match=bool(is_match)))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _persist_attention(db_id, attempt_id, score):
    db = SessionLocal()
    try:
        db.add(AttentionScore(student_id=db_id, attempt_id=attempt_id, score=float(score)))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()