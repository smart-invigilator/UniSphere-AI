"""
Socket.IO server. Real-time layer is scoped per exam session: every student
connection is tied to a specific ExamAttempt, and teacher dashboards
subscribe to a specific exam's room, so a teacher monitoring Exam A never
sees Exam B. Students never join the dashboard room: they only ever receive
their own status and alerts.

Event contract:

Student -> Server:
  'student:join'      { token, attempt_id }      -> authenticates, binds the socket to the attempt
  'frame:webcam'      { image (base64 jpeg) }    -> relayed to dashboards, analyzed (behavior + identity)
  'frame:screen'      { image (base64 jpeg) }    -> relayed to dashboards
  'client:violation'  { type }                   -> browser-detected event (see CLIENT_VIOLATION_TYPES)
  'audio:level'       { level (0-1 RMS) }        -> voice-activity tracking (Talking Detected)
  'heartbeat'         {}
  'phone:host' / 'phone:join' / 'phone:signal'  -> phone-as-camera pairing (see section below)

Server -> Student (own data only):
  'students:tick'  [own student]
  'alert'          { alert, student }

Dashboard (teacher) -> Server:
  'dashboard:join' { token, exam_id }         -> joins room 'exam:{exam_id}'

Server -> Dashboard:
  'students:init'  [student,...]
  'students:tick'  [student,...]
  'alert'          { alert, student }
  'frame:webcam'   { studentId, image }
  'frame:screen'   { studentId, image }
"""
import asyncio
import logging
import time

import socketio

from app.core.security import decode_token, create_phone_camera_token, PHONE_CAMERA_TOKEN_TYPE
from app.core.refs import ATTEMPT, EXAM, decode_ref, encode_ref
from app.core.config import settings
from app.realtime.manager import manager
from app.realtime.pipeline import pipeline
from app.realtime.db_writer import writer, persist_alert
from app.ai.audio import audio_analyzer
from app.db.session import SessionLocal
from app.models.user import User
from app.models.student import Student
from app.models.exam import ExamSession
from app.models.attempt import ExamAttempt

logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.cors_list,
    max_http_buffer_size=settings.SOCKET_MAX_MESSAGE_BYTES,
)

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
WEBCAM_MIN_INTERVAL_SECONDS = 0.1
SCREEN_MIN_INTERVAL_SECONDS = 0.4

_last_frame_at: dict[tuple[str, str], float] = {}
_background: list[asyncio.Task] = []


def _room(exam_id) -> str:
    return f"exam:{exam_id}"


class TickThrottle:
    def __init__(self, interval_seconds: float):
        self.interval = interval_seconds
        self._last: dict[int, float] = {}
        self._pending: set[int] = set()

    def request(self, exam_id: int) -> None:
        if exam_id in self._pending:
            return
        loop = asyncio.get_running_loop()
        wait = self._last.get(exam_id, 0.0) + self.interval - loop.time()
        self._pending.add(exam_id)
        loop.call_later(max(0.0, wait), lambda: asyncio.ensure_future(self._fire(exam_id)))

    async def _fire(self, exam_id: int) -> None:
        self._pending.discard(exam_id)
        self._last[exam_id] = asyncio.get_running_loop().time()
        try:
            students = manager.students_in_exam(exam_id)
            await sio.emit("students:tick", [s.to_dict() for s in students], room=_room(exam_id))
            for s in students:
                sid = s.sid
                if s.connected and sid:
                    await sio.emit("students:tick", [s.to_dict()], to=sid)
        except Exception:
            logger.exception("Failed to emit students:tick for exam %s", exam_id)


ticks = TickThrottle(settings.DASHBOARD_TICK_INTERVAL_MS / 1000.0)


async def _emit_alert(s, alert: dict, screenshot: str | None = None) -> None:
    try:
        fired = await persist_alert(s, alert, screenshot=screenshot)
    except Exception:
        logger.exception("Failed to persist alert %s for attempt %s", alert.get("alert_type"), s.attempt_id)
        return
    payload = {"alert": fired, "student": s.to_dict()}
    await sio.emit("alert", payload, room=_room(s.exam_id))
    sid = s.sid
    if s.connected and sid:
        await sio.emit("alert", payload, to=sid)
    ticks.request(s.exam_id)


pipeline.bind(emit_alert=_emit_alert, request_tick=ticks.request)


def _image_from(data) -> str | None:
    image = data.get("image") if isinstance(data, dict) else None
    if not isinstance(image, str) or not image:
        return None
    if len(image) > settings.MAX_FRAME_CHARS:
        pipeline.oversized += 1
        return None
    return image


def _allow_frame(sid: str, kind: str, min_interval: float) -> bool:
    now = time.monotonic()
    key = (sid, kind)
    if now - _last_frame_at.get(key, 0.0) < min_interval:
        return False
    _last_frame_at[key] = now
    return True


@sio.event
async def connect(sid, environ):
    pass


@sio.event
async def disconnect(sid):
    _last_frame_at.pop((sid, "webcam"), None)
    _last_frame_at.pop((sid, "screen"), None)
    await _phone_disconnect(sid)
    s = manager.disconnect(sid)
    if s:
        ticks.request(s.exam_id)


def _authorize_dashboard(user_id: int, exam_id: int) -> str | None:
    db = SessionLocal()
    try:
        exam = db.get(ExamSession, exam_id)
        if not exam:
            return "exam not found"
        if exam.course.teacher_id != user_id:
            user = db.get(User, user_id)
            if not user or user.role.value != "admin":
                return "forbidden"
        return None
    finally:
        db.close()


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
        exam_id = decode_ref(EXAM, exam_id)
    except Exception:
        return {"ok": False, "error": "invalid token"}

    error = await asyncio.to_thread(_authorize_dashboard, user_id, exam_id)
    if error:
        return {"ok": False, "error": error}

    await sio.enter_room(sid, _room(exam_id))
    await sio.emit("students:init", manager.snapshot(exam_id), to=sid)
    return {"ok": True}


def _load_student_attempt(user_id: int, attempt_id: int, allowed_statuses: tuple[str, ...] = ("in_progress",)):
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        attempt = db.get(ExamAttempt, attempt_id)
        if not user or not attempt:
            return None, "not found"
        prof = db.query(Student).filter(Student.user_id == user_id).first()
        if not prof or attempt.student_id != prof.id:
            return None, "forbidden"
        if attempt.status not in allowed_statuses:
            return None, "attempt is not in progress"
        return {
            "attempt_id": attempt.id, "exam_id": attempt.exam_id, "student_code": prof.student_id,
            "name": user.name, "db_id": prof.id, "department": prof.department,
            "reference_embedding": attempt.reference_embedding,
        }, None
    finally:
        db.close()


@sio.on("student:join")
async def student_join(sid, data):
    token = (data or {}).get("token", "")
    attempt_id = (data or {}).get("attempt_id")
    if not attempt_id:
        return {"ok": False, "error": "attempt_id required"}
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return {"ok": False, "error": "invalid token"}
        user_id = int(payload["sub"])
        attempt_id = decode_ref(ATTEMPT, attempt_id)
    except Exception:
        return {"ok": False, "error": "invalid token"}

    info, error = await asyncio.to_thread(_load_student_attempt, user_id, attempt_id)
    if error:
        return {"ok": False, "error": error}

    writer.start()
    live = manager.register(
        attempt_id=info["attempt_id"], exam_id=info["exam_id"], student_id=info["student_code"],
        name=info["name"], db_id=info["db_id"], department=info["department"],
        reference_embedding=info["reference_embedding"],
    )
    manager.connect(live.attempt_id, sid)
    ticks.request(live.exam_id)
    return {"ok": True, "studentId": live.student_id, "examId": encode_ref(EXAM, live.exam_id)}


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
    await _emit_alert(s, {"alert_type": alert_type, "severity": severity, "confidence": confidence, "ts": now})


@sio.on("audio:level")
async def audio_level(sid, data):
    s = manager.by_sid(sid)
    if not s:
        return
    try:
        level = float((data or {}).get("level", 0) or 0)
    except (TypeError, ValueError):
        return
    now = time.time()
    s.audio_level = round(level, 3)

    alert = audio_analyzer.analyze(level, s, now=now)
    if alert is not None:
        s.alert_count += 1
        s.status = "alert"
        await _emit_alert(s, alert)


@sio.on("frame:screen")
async def frame_screen(sid, data):
    s = manager.by_sid(sid)
    if not s:
        return
    image = _image_from(data)
    if image is None or not _allow_frame(sid, "screen", SCREEN_MIN_INTERVAL_SECONDS):
        return
    await sio.emit("frame:screen", {"studentId": s.student_id, "image": image}, room=_room(s.exam_id))


@sio.on("frame:webcam")
async def frame_webcam(sid, data):
    s = manager.by_sid(sid)
    if not s:
        return
    image = _image_from(data)
    if image is None or not _allow_frame(sid, "webcam", WEBCAM_MIN_INTERVAL_SECONDS):
        return
    s.last_activity = time.time()
    await sio.emit("frame:webcam", {"studentId": s.student_id, "image": image}, room=_room(s.exam_id))
    pipeline.submit_webcam(s, image)


# ---------------------------------------------------------------------------
# Phone-as-camera pairing (WebRTC signaling only; media flows peer-to-peer).
#
#   Laptop (student) -> 'phone:host'   { token, attempt_id } -> { ok, pair_token }
#   Phone            -> 'phone:join'   { pair_token }        -> { ok }
#   Either side      -> 'phone:signal' { data }              -> relayed to the other side
#   Server -> laptop:  'phone:peer'    { connected }
#   Server -> phone:   'phone:host-left' / 'phone:replaced'
# ---------------------------------------------------------------------------
_phone_peers: dict[str, tuple[int, str]] = {}   # sid -> (attempt_id, "host" | "phone")
MAX_SIGNAL_CHARS = 64_000
# Pairing happens during the pre-exam checklist, before the attempt is in_progress.
PHONE_ATTEMPT_STATUSES = ("checklist", "in_progress")


def _phone_room(attempt_id: int) -> str:
    return f"phone:{attempt_id}"


def _phone_sids(attempt_id: int, role: str, exclude: str | None = None) -> list[str]:
    return [s for s, (a, r) in _phone_peers.items() if a == attempt_id and r == role and s != exclude]


@sio.on("phone:host")
async def phone_host(sid, data):
    token = (data or {}).get("token", "")
    attempt_ref = (data or {}).get("attempt_id")
    if not attempt_ref:
        return {"ok": False, "error": "attempt_id required"}
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return {"ok": False, "error": "invalid token"}
        user_id = int(payload["sub"])
        attempt_id = decode_ref(ATTEMPT, attempt_ref)
    except Exception:
        return {"ok": False, "error": "invalid token"}
    info, error = await asyncio.to_thread(_load_student_attempt, user_id, attempt_id, PHONE_ATTEMPT_STATUSES)
    if error:
        return {"ok": False, "error": error}

    for old in _phone_sids(attempt_id, "host", exclude=sid):
        _phone_peers.pop(old, None)
        await sio.leave_room(old, _phone_room(attempt_id))
    _phone_peers[sid] = (attempt_id, "host")
    await sio.enter_room(sid, _phone_room(attempt_id))
    pair_token = create_phone_camera_token(user_id, encode_ref(ATTEMPT, attempt_id))
    return {"ok": True, "pair_token": pair_token, "phone_connected": bool(_phone_sids(attempt_id, "phone"))}


@sio.on("phone:join")
async def phone_join(sid, data):
    token = (data or {}).get("pair_token", "")
    try:
        payload = decode_token(token)
        if payload.get("type") != PHONE_CAMERA_TOKEN_TYPE:
            return {"ok": False, "error": "invalid token"}
        user_id = int(payload["sub"])
        attempt_id = decode_ref(ATTEMPT, payload["attempt"])
    except Exception:
        return {"ok": False, "error": "This pairing link is invalid or has expired."}
    info, error = await asyncio.to_thread(_load_student_attempt, user_id, attempt_id, PHONE_ATTEMPT_STATUSES)
    if error:
        return {"ok": False, "error": "This exam attempt is no longer active."}
    if not _phone_sids(attempt_id, "host"):
        return {"ok": False, "error": "Open the exam on your computer first, then scan the QR code again."}

    # Only one phone per attempt: a newer scan replaces the previous one.
    for old in _phone_sids(attempt_id, "phone", exclude=sid):
        _phone_peers.pop(old, None)
        await sio.emit("phone:replaced", {}, to=old)
        await sio.leave_room(old, _phone_room(attempt_id))
    _phone_peers[sid] = (attempt_id, "phone")
    await sio.enter_room(sid, _phone_room(attempt_id))
    await sio.emit("phone:peer", {"connected": True}, room=_phone_room(attempt_id), skip_sid=sid)
    return {"ok": True}


@sio.on("phone:signal")
async def phone_signal(sid, data):
    peer = _phone_peers.get(sid)
    if not peer:
        return
    body = (data or {}).get("data")
    if body is None or len(str(body)) > MAX_SIGNAL_CHARS:
        return
    await sio.emit("phone:signal", {"data": body}, room=_phone_room(peer[0]), skip_sid=sid)


async def _phone_disconnect(sid: str) -> None:
    peer = _phone_peers.pop(sid, None)
    if not peer:
        return
    attempt_id, role = peer
    if role == "phone":
        await sio.emit("phone:peer", {"connected": False}, room=_phone_room(attempt_id), skip_sid=sid)
    else:
        await sio.emit("phone:host-left", {}, room=_phone_room(attempt_id), skip_sid=sid)


async def _sweep_idle_sessions() -> None:
    while True:
        await asyncio.sleep(600)
        try:
            for s in manager.remove_idle(settings.LIVE_SESSION_IDLE_SECONDS):
                pipeline.cancel_student(s)
        except Exception:
            logger.exception("Idle session sweep failed")


async def realtime_startup() -> None:
    from app.ai.analyzer import analyzer
    from app.ai.engine import engine
    writer.start()
    _background.append(asyncio.create_task(_sweep_idle_sessions(), name="idle-session-sweeper"))
    await asyncio.to_thread(engine.warmup, analyzer.warm_worker)


async def realtime_shutdown() -> None:
    from app.ai.engine import engine
    for task in _background:
        task.cancel()
    _background.clear()
    await pipeline.stop(manager.all_students())
    await writer.stop()
    await asyncio.to_thread(engine.shutdown, True)


def realtime_stats() -> dict:
    from app.ai.engine import engine
    return {
        "live_sessions": manager.count(),
        "pipeline": pipeline.stats(),
        "engine": engine.stats(),
        "db_writer": writer.stats(),
    }