import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, or_, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession, selectinload

from app.api.deps import get_current_user, require_roles
from app.core.config import settings as app_settings
from app.core.ratelimit import TokenBucketLimiter
from app.db.session import get_db, SessionLocal
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.live_class import (
    LiveClass, LiveClassAttendance, LiveClassMessage, DEFAULT_LIVE_SETTINGS, gen_meeting_code, gen_room_name,
)
from app.models.student import Student
from app.models.user import User, Role
from app.schemas.live_class import (
    LiveClassCreate, LiveClassUpdate, LiveSettingsUpdate, LiveClassOut, JoinOut, ParticipantPermissionsIn,
    MuteIn, HandIn, RequestIn, MessageIn, MessageOut, ReactionIn, AttendanceOut, AttendanceRow,
)
from app.services import livekit as lk

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/live-classes", tags=["live-classes"])

chat_limiter = TokenBucketLimiter(rate_per_second=1.0, burst=6)
reaction_limiter = TokenBucketLimiter(rate_per_second=2.0, burst=8)
state_limiter = TokenBucketLimiter(rate_per_second=1.0, burst=5)
moderation_limiter = TokenBucketLimiter(rate_per_second=5.0, burst=20)

PUBLIC_SETTING_KEYS = ("chat_enabled", "qa_enabled", "locked", "allow_student_mic", "allow_student_camera",
                       "allow_student_screen", "spotlight")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _settings(lc: LiveClass) -> dict:
    merged = {**DEFAULT_LIVE_SETTINGS, "qa_enabled": True}
    merged.update(lc.settings or {})
    return merged


def public_settings(lc: LiveClass) -> dict:
    s = _settings(lc)
    return {k: s.get(k) for k in PUBLIC_SETTING_KEYS}


def student_sources(lc: LiveClass, user_id: int) -> list[str]:
    s = _settings(lc)
    grant = (s.get("grants") or {}).get(str(user_id), {})

    def allowed(key: str, flag: str) -> bool:
        return bool(grant[key]) if key in grant else bool(s.get(flag))

    out = []
    if allowed("microphone", "allow_student_mic"):
        out.append(lk.SOURCE_MICROPHONE)
    if allowed("camera", "allow_student_camera"):
        out.append(lk.SOURCE_CAMERA)
    if allowed("screen", "allow_student_screen"):
        out += [lk.SOURCE_SCREEN, lk.SOURCE_SCREEN_AUDIO]
    return out


def _role_in(lc: LiveClass, user: User, db: DBSession) -> str | None:
    if lc.course.teacher_id == user.id or user.role == Role.admin:
        return "teacher"
    if user.role != Role.student:
        return None
    enrolled = db.scalar(
        select(Enrollment.id).join(Student, Enrollment.student_id == Student.id)
        .where(Student.user_id == user.id, Enrollment.course_id == lc.course_id)
    )
    return "student" if enrolled else None


def _get_class(class_id: int, db: DBSession, lock: bool = False) -> LiveClass:
    q = select(LiveClass).where(LiveClass.id == class_id).options(
        selectinload(LiveClass.course), selectinload(LiveClass.teacher),
    )
    if lock:
        q = q.with_for_update(of=LiveClass)
    lc = db.scalar(q)
    if not lc:
        raise HTTPException(404, "Live class not found")
    return lc


def _member(class_id: int, user: User, db: DBSession, lock: bool = False) -> tuple[LiveClass, str]:
    lc = _get_class(class_id, db, lock=lock)
    role = _role_in(lc, user, db)
    if role is None:
        raise HTTPException(403, "You are not a member of this class's course")
    return lc, role


def _teacher(class_id: int, user: User, db: DBSession, lock: bool = False) -> LiveClass:
    lc, role = _member(class_id, user, db, lock=lock)
    if role != "teacher":
        raise HTTPException(403, "Only the class teacher can do this")
    return lc


def _out(lc: LiveClass, role: str) -> LiveClassOut:
    return LiveClassOut(
        id=lc.id, course_id=lc.course_id, course_title=lc.course.title, teacher_name=lc.teacher.name,
        title=lc.title, description=lc.description, status=lc.status,
        scheduled_start=_utc(lc.scheduled_start), started_at=_utc(lc.started_at), ended_at=_utc(lc.ended_at),
        meeting_code=lc.meeting_code, created_at=_utc(lc.created_at), my_role=role, settings=public_settings(lc),
    )


def _media_error(exc: lk.LiveKitError) -> HTTPException:
    if isinstance(exc, lk.LiveKitNotConfigured):
        return HTTPException(503, "Live classes are not set up on this server yet. Ask the administrator to configure the media server.")
    logger.error("LiveKit error: %s", exc)
    return HTTPException(503, "The live class media server is not responding. Please try again in a moment.")


def _limit(limiter: TokenBucketLimiter, user: User, scope: str) -> None:
    if not limiter.allow(f"{scope}:{user.id}"):
        raise HTTPException(429, "You're doing that too quickly. Please wait a moment.")


def _require_live(lc: LiveClass) -> None:
    if lc.status != "live":
        raise HTTPException(409, "This class is not live right now.")


def _broadcast(lc: LiveClass, topic: str, payload: dict, reliable: bool = True, to: list[str] | None = None) -> None:
    try:
        lk.send_data(lc.room_name, topic, payload, reliable=reliable, destination_identities=to)
    except lk.LiveKitError as exc:
        raise _media_error(exc)


def _finalize_attendance(db: DBSession, lc: LiveClass, at: datetime) -> None:
    rows = db.scalars(
        select(LiveClassAttendance).where(LiveClassAttendance.live_class_id == lc.id, LiveClassAttendance.is_connected.is_(True))
    ).all()
    for row in rows:
        row.total_seconds += max(0, int((at - _utc(row.last_joined_at)).total_seconds()))
        row.is_connected = False
        row.last_left_at = at


@router.post("", response_model=LiveClassOut, status_code=201)
def create_live_class(data: LiveClassCreate, db: DBSession = Depends(get_db),
                      user: User = Depends(require_roles(Role.teacher, Role.admin))):
    course = db.get(Course, data.course_id)
    if not course:
        raise HTTPException(404, "Course not found")
    if course.teacher_id != user.id and user.role != Role.admin:
        raise HTTPException(403, "You can only create live classes for your own courses")
    if not data.start_now and data.scheduled_start is None:
        raise HTTPException(422, "Choose a start date and time, or start the class now")
    if not data.start_now and data.scheduled_start < _now() - timedelta(minutes=5):
        raise HTTPException(422, "The start time is in the past")
    code = gen_meeting_code()
    while db.scalar(select(LiveClass.id).where(LiveClass.meeting_code == code)):
        code = gen_meeting_code()
    lc = LiveClass(
        course_id=course.id, teacher_id=course.teacher_id, title=data.title.strip(), description=data.description.strip(),
        scheduled_start=data.scheduled_start or _now(), settings={**DEFAULT_LIVE_SETTINGS, "qa_enabled": True},
        meeting_code=code, room_name=gen_room_name(),
    )
    db.add(lc)
    db.flush()
    if data.start_now:
        try:
            lk.create_room(lc.room_name, public_settings(lc), app_settings.LIVE_MAX_PARTICIPANTS)
        except lk.LiveKitError as exc:
            db.rollback()
            raise _media_error(exc)
        lc.status = "live"
        lc.started_at = _now()
    db.commit()
    lc = _get_class(lc.id, db)
    return _out(lc, "teacher")


@router.get("/mine", response_model=list[LiveClassOut])
def my_live_classes(db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    recent = _now() - timedelta(days=14)
    visible = or_(LiveClass.status.in_(("scheduled", "live")), and_(LiveClass.status == "ended", LiveClass.ended_at >= recent))
    q = select(LiveClass).options(selectinload(LiveClass.course), selectinload(LiveClass.teacher)).where(visible)
    if user.role == Role.student:
        course_ids = db.scalars(
            select(Enrollment.course_id).join(Student, Enrollment.student_id == Student.id).where(Student.user_id == user.id)
        ).all()
        if not course_ids:
            return []
        q = q.where(LiveClass.course_id.in_(course_ids))
        role = "student"
    elif user.role == Role.admin:
        role = "teacher"
    else:
        q = q.join(Course, LiveClass.course_id == Course.id).where(Course.teacher_id == user.id)
        role = "teacher"
    rows = db.scalars(q.order_by(LiveClass.scheduled_start.asc()).limit(200)).all()
    order = {"live": 0, "scheduled": 1, "ended": 2}
    rows = sorted(rows, key=lambda r: (order.get(r.status, 3), _utc(r.scheduled_start) or _now()))
    return [_out(r, role) for r in rows]


@router.get("/by-code/{code}", response_model=LiveClassOut)
def resolve_meeting_code(code: str, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    lc_id = db.scalar(select(LiveClass.id).where(LiveClass.meeting_code == code.strip().lower()))
    if not lc_id:
        raise HTTPException(404, "No live class matches this meeting code")
    lc, role = _member(lc_id, user, db)
    return _out(lc, role)


@router.get("/{class_id}", response_model=LiveClassOut)
def get_live_class(class_id: int, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    lc, role = _member(class_id, user, db)
    return _out(lc, role)


@router.patch("/{class_id}", response_model=LiveClassOut)
def update_live_class(class_id: int, data: LiveClassUpdate, db: DBSession = Depends(get_db),
                      user: User = Depends(require_roles(Role.teacher, Role.admin))):
    lc = _teacher(class_id, user, db, lock=True)
    if lc.status not in ("scheduled", "live"):
        raise HTTPException(409, "This class has already ended")
    lc.title = data.title.strip()
    lc.description = data.description.strip()
    if lc.status == "scheduled":
        if data.scheduled_start is None:
            raise HTTPException(422, "Choose a start date and time")
        lc.scheduled_start = data.scheduled_start
    db.commit()
    return _out(_get_class(class_id, db), "teacher")


@router.delete("/{class_id}", status_code=204)
def cancel_live_class(class_id: int, db: DBSession = Depends(get_db),
                      user: User = Depends(require_roles(Role.teacher, Role.admin))):
    lc = _teacher(class_id, user, db, lock=True)
    if lc.status != "scheduled":
        raise HTTPException(409, "Only scheduled classes can be cancelled. End a live class instead.")
    lc.status = "cancelled"
    lc.ended_at = _now()
    db.commit()


@router.post("/{class_id}/start", response_model=LiveClassOut)
def start_live_class(class_id: int, db: DBSession = Depends(get_db),
                     user: User = Depends(require_roles(Role.teacher, Role.admin))):
    lc = _teacher(class_id, user, db, lock=True)
    if lc.status == "live":
        return _out(lc, "teacher")
    if lc.status != "scheduled":
        raise HTTPException(409, "This class has already ended")
    try:
        lk.create_room(lc.room_name, public_settings(lc), app_settings.LIVE_MAX_PARTICIPANTS)
    except lk.LiveKitError as exc:
        raise _media_error(exc)
    lc.status = "live"
    lc.started_at = _now()
    db.commit()
    return _out(_get_class(class_id, db), "teacher")


@router.post("/{class_id}/end", response_model=LiveClassOut)
def end_live_class(class_id: int, db: DBSession = Depends(get_db),
                   user: User = Depends(require_roles(Role.teacher, Role.admin))):
    lc = _teacher(class_id, user, db, lock=True)
    if lc.status != "live":
        raise HTTPException(409, "This class is not live")
    ended = _now()
    lc.status = "ended"
    lc.ended_at = ended
    _finalize_attendance(db, lc, ended)
    db.commit()
    try:
        lk.send_data(lc.room_name, "lc.ended", {"by": user.name, "at": int(ended.timestamp() * 1000)})
    except lk.LiveKitError:
        pass
    try:
        lk.delete_room(lc.room_name)
    except lk.LiveKitError as exc:
        logger.error("Could not close LiveKit room %s: %s", lc.room_name, exc)
    return _out(_get_class(class_id, db), "teacher")


@router.post("/{class_id}/join", response_model=JoinOut)
def join_live_class(class_id: int, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    lc, role = _member(class_id, user, db)
    if lc.status in ("ended", "cancelled"):
        raise HTTPException(410, "This class has ended.")
    if lc.status != "live":
        raise HTTPException(409, "The teacher hasn't started this class yet." if role == "student" else "Start the class first.")
    s = _settings(lc)
    if role == "student":
        if user.id in (s.get("removed") or []):
            raise HTTPException(403, "The teacher removed you from this class.")
        if s.get("locked"):
            joined_before = db.scalar(select(LiveClassAttendance.id).where(
                LiveClassAttendance.live_class_id == lc.id, LiveClassAttendance.user_id == user.id))
            if not joined_before:
                raise HTTPException(403, "The teacher has locked this class. New participants can't join right now.")
        sources = student_sources(lc, user.id)
    else:
        sources = list(lk.ALL_SOURCES)
    identity = lk.identity_for(user.id)
    try:
        token = lk.create_join_token(
            room=lc.room_name, identity=identity, name=user.name,
            metadata={"role": role, "userId": user.id}, attributes={"role": role}, can_publish_sources=sources,
        )
    except lk.LiveKitError as exc:
        raise _media_error(exc)
    return JoinOut(url=app_settings.LIVEKIT_URL, token=token, identity=identity, role=role, live_class=_out(lc, role))


def _participant_identities(lc: LiveClass, students_only: bool = True) -> list[dict]:
    participants = lk.list_participants(lc.room_name)
    out = []
    for p in participants:
        uid = lk.user_id_from_identity(p.get("identity"))
        if uid is None:
            continue
        role = (p.get("attributes") or {}).get("role", "student")
        if students_only and role == "teacher":
            continue
        out.append({"identity": p["identity"], "user_id": uid, "tracks": p.get("tracks") or []})
    return out


@router.patch("/{class_id}/settings")
def update_settings(class_id: int, data: LiveSettingsUpdate, db: DBSession = Depends(get_db),
                    user: User = Depends(require_roles(Role.teacher, Role.admin))):
    _limit(moderation_limiter, user, "moderate")
    lc = _teacher(class_id, user, db, lock=True)
    s = _settings(lc)
    before = (s.get("allow_student_mic"), s.get("allow_student_camera"), s.get("allow_student_screen"))
    for key in ("chat_enabled", "qa_enabled", "locked", "allow_student_mic", "allow_student_camera", "allow_student_screen"):
        value = getattr(data, key)
        if value is not None:
            s[key] = value
    if data.clear_spotlight:
        s["spotlight"] = None
    elif data.spotlight is not None:
        s["spotlight"] = data.spotlight
    lc.settings = s
    db.commit()
    if lc.status == "live":
        try:
            lk.update_room_metadata(lc.room_name, public_settings(lc))
            after = (s.get("allow_student_mic"), s.get("allow_student_camera"), s.get("allow_student_screen"))
            if after != before:
                for p in _participant_identities(lc):
                    lk.update_participant(lc.room_name, p["identity"], sources=student_sources(lc, p["user_id"]))
        except lk.LiveKitError as exc:
            raise _media_error(exc)
    return public_settings(lc)


@router.post("/{class_id}/participants/{user_id}/mute", status_code=204)
def mute_participant(class_id: int, user_id: int, data: MuteIn, db: DBSession = Depends(get_db),
                     user: User = Depends(require_roles(Role.teacher, Role.admin))):
    _limit(moderation_limiter, user, "moderate")
    lc = _teacher(class_id, user, db)
    _require_live(lc)
    try:
        for p in _participant_identities(lc, students_only=False):
            if p["user_id"] != user_id:
                continue
            for t in p["tracks"]:
                if lk.track_source(t) == data.source and not t.get("muted"):
                    lk.mute_published_track(lc.room_name, p["identity"], t["sid"], True)
            lk.send_data(lc.room_name, "lc.notice", {"type": "muted", "source": data.source, "by": user.name},
                         destination_identities=[p["identity"]])
    except lk.LiveKitError as exc:
        raise _media_error(exc)


@router.post("/{class_id}/mute-all", status_code=204)
def mute_all(class_id: int, db: DBSession = Depends(get_db),
             user: User = Depends(require_roles(Role.teacher, Role.admin))):
    _limit(moderation_limiter, user, "moderate")
    lc = _teacher(class_id, user, db)
    _require_live(lc)
    try:
        muted = []
        for p in _participant_identities(lc):
            for t in p["tracks"]:
                if lk.track_source(t) == lk.SOURCE_MICROPHONE and not t.get("muted"):
                    lk.mute_published_track(lc.room_name, p["identity"], t["sid"], True)
                    muted.append(p["identity"])
        if muted:
            lk.send_data(lc.room_name, "lc.notice", {"type": "muted", "source": "microphone", "by": user.name},
                         destination_identities=muted)
    except lk.LiveKitError as exc:
        raise _media_error(exc)


@router.post("/{class_id}/participants/{user_id}/remove", status_code=204)
def remove_participant(class_id: int, user_id: int, db: DBSession = Depends(get_db),
                       user: User = Depends(require_roles(Role.teacher, Role.admin))):
    _limit(moderation_limiter, user, "moderate")
    lc = _teacher(class_id, user, db, lock=True)
    if user_id == lc.course.teacher_id:
        raise HTTPException(400, "The teacher can't be removed")
    s = _settings(lc)
    removed = set(s.get("removed") or [])
    removed.add(user_id)
    s["removed"] = sorted(removed)
    lc.settings = s
    db.commit()
    if lc.status == "live":
        try:
            lk.remove_participant(lc.room_name, lk.identity_for(user_id))
        except lk.LiveKitError as exc:
            raise _media_error(exc)


@router.post("/{class_id}/participants/{user_id}/readmit", status_code=204)
def readmit_participant(class_id: int, user_id: int, db: DBSession = Depends(get_db),
                        user: User = Depends(require_roles(Role.teacher, Role.admin))):
    lc = _teacher(class_id, user, db, lock=True)
    s = _settings(lc)
    s["removed"] = [u for u in (s.get("removed") or []) if u != user_id]
    lc.settings = s
    db.commit()


@router.post("/{class_id}/participants/{user_id}/permissions")
def set_participant_permissions(class_id: int, user_id: int, data: ParticipantPermissionsIn, db: DBSession = Depends(get_db),
                                user: User = Depends(require_roles(Role.teacher, Role.admin))):
    _limit(moderation_limiter, user, "moderate")
    lc = _teacher(class_id, user, db, lock=True)
    s = _settings(lc)
    grants = dict(s.get("grants") or {})
    current = {} if data.reset else dict(grants.get(str(user_id), {}))
    for key in ("microphone", "camera", "screen"):
        value = getattr(data, key)
        if value is not None:
            current[key] = value
    if current:
        grants[str(user_id)] = current
    else:
        grants.pop(str(user_id), None)
    s["grants"] = grants
    lc.settings = s
    db.commit()
    sources = student_sources(lc, user_id)
    if lc.status == "live":
        try:
            lk.update_participant(lc.room_name, lk.identity_for(user_id), sources=sources, attributes={"request": ""})
            lk.send_data(lc.room_name, "lc.notice", {"type": "permissions", "sources": sources, "by": user.name},
                         destination_identities=[lk.identity_for(user_id)])
        except lk.LiveKitError as exc:
            raise _media_error(exc)
    return {"user_id": user_id, "sources": sources}


@router.post("/{class_id}/participants/{user_id}/lower-hand", status_code=204)
def lower_hand(class_id: int, user_id: int, db: DBSession = Depends(get_db),
               user: User = Depends(require_roles(Role.teacher, Role.admin))):
    lc = _teacher(class_id, user, db)
    _require_live(lc)
    try:
        lk.update_participant(lc.room_name, lk.identity_for(user_id), attributes={"hand": "", "request": ""})
    except lk.LiveKitError as exc:
        raise _media_error(exc)


@router.post("/{class_id}/hand", status_code=204)
def raise_hand(class_id: int, data: HandIn, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    _limit(state_limiter, user, "hand")
    lc, _role = _member(class_id, user, db)
    _require_live(lc)
    try:
        lk.update_participant(lc.room_name, lk.identity_for(user.id),
                              attributes={"hand": str(int(time.time() * 1000)) if data.raised else ""})
    except lk.LiveKitError as exc:
        raise _media_error(exc)


@router.post("/{class_id}/request", status_code=204)
def request_permission(class_id: int, data: RequestIn, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    _limit(state_limiter, user, "request")
    lc, role = _member(class_id, user, db)
    _require_live(lc)
    if role != "student":
        raise HTTPException(400, "Only students can request permissions")
    try:
        lk.update_participant(lc.room_name, lk.identity_for(user.id), attributes={"request": data.kind})
    except lk.LiveKitError as exc:
        raise _media_error(exc)


def _message_out(m: LiveClassMessage, teacher_id: int) -> MessageOut:
    return MessageOut(
        id=m.id, kind=m.kind, text=m.text, user_id=m.user_id, identity=lk.identity_for(m.user_id),
        name=m.user.name, role="teacher" if m.user_id == teacher_id else "student",
        answered=m.answered, hidden=m.hidden, created_at=_utc(m.created_at),
    )


@router.get("/{class_id}/messages", response_model=list[MessageOut])
def list_messages(class_id: int, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    lc, role = _member(class_id, user, db)
    q = (select(LiveClassMessage).options(selectinload(LiveClassMessage.user))
         .where(LiveClassMessage.live_class_id == lc.id))
    if role != "teacher":
        q = q.where(LiveClassMessage.hidden.is_(False))
    rows = db.scalars(q.order_by(LiveClassMessage.created_at.desc(), LiveClassMessage.id.desc()).limit(300)).all()
    return [_message_out(m, lc.course.teacher_id) for m in reversed(rows)]


@router.post("/{class_id}/messages", response_model=MessageOut, status_code=201)
def post_message(class_id: int, data: MessageIn, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    _limit(chat_limiter, user, "chat")
    lc, role = _member(class_id, user, db)
    _require_live(lc)
    s = _settings(lc)
    if role != "teacher":
        if data.kind == "chat" and not s.get("chat_enabled"):
            raise HTTPException(403, "The teacher has turned off chat.")
        if data.kind == "question" and not s.get("qa_enabled"):
            raise HTTPException(403, "The teacher has turned off questions.")
        if user.id in (s.get("removed") or []):
            raise HTTPException(403, "The teacher removed you from this class.")
    m = LiveClassMessage(live_class_id=lc.id, user_id=user.id, kind=data.kind, text=data.text)
    db.add(m)
    db.commit()
    db.refresh(m)
    out = _message_out(m, lc.course.teacher_id)
    _broadcast(lc, "lc.message", out.model_dump(mode="json"))
    return out


def _moderate_message(class_id: int, message_id: int, user: User, db: DBSession, **changes) -> MessageOut:
    lc = _teacher(class_id, user, db)
    m = db.scalar(select(LiveClassMessage).options(selectinload(LiveClassMessage.user))
                  .where(LiveClassMessage.id == message_id, LiveClassMessage.live_class_id == lc.id))
    if not m:
        raise HTTPException(404, "Message not found")
    for k, v in changes.items():
        setattr(m, k, v)
    db.commit()
    out = _message_out(m, lc.course.teacher_id)
    if lc.status == "live":
        _broadcast(lc, "lc.message.update", out.model_dump(mode="json"))
    return out


@router.post("/{class_id}/messages/{message_id}/answer", response_model=MessageOut)
def mark_answered(class_id: int, message_id: int, db: DBSession = Depends(get_db),
                  user: User = Depends(require_roles(Role.teacher, Role.admin))):
    return _moderate_message(class_id, message_id, user, db, answered=True)


@router.post("/{class_id}/messages/{message_id}/hide", response_model=MessageOut)
def hide_message(class_id: int, message_id: int, db: DBSession = Depends(get_db),
                 user: User = Depends(require_roles(Role.teacher, Role.admin))):
    return _moderate_message(class_id, message_id, user, db, hidden=True)


@router.post("/{class_id}/reactions", status_code=204)
def react(class_id: int, data: ReactionIn, db: DBSession = Depends(get_db), user: User = Depends(get_current_user)):
    _limit(reaction_limiter, user, "react")
    lc, _role = _member(class_id, user, db)
    _require_live(lc)
    _broadcast(lc, "lc.reaction", {"identity": lk.identity_for(user.id), "name": user.name, "emoji": data.emoji,
                                   "ts": int(time.time() * 1000)}, reliable=False)


@router.get("/{class_id}/attendance", response_model=AttendanceOut)
def attendance(class_id: int, db: DBSession = Depends(get_db),
               user: User = Depends(require_roles(Role.teacher, Role.admin))):
    lc = _teacher(class_id, user, db)
    now = _now()
    records = {r.user_id: r for r in db.scalars(
        select(LiveClassAttendance).where(LiveClassAttendance.live_class_id == lc.id)).all()}
    enrolled = db.execute(
        select(User.id, User.name, Student.student_id)
        .join(Student, Student.user_id == User.id)
        .join(Enrollment, Enrollment.student_id == Student.id)
        .where(Enrollment.course_id == lc.course_id)
        .order_by(User.name)
    ).all()
    rows = []
    present = 0
    for uid, name, code in enrolled:
        r = records.get(uid)
        total = 0
        if r:
            total = r.total_seconds + (int((now - _utc(r.last_joined_at)).total_seconds()) if r.is_connected else 0)
        is_present = total >= app_settings.LIVE_ATTENDANCE_MIN_SECONDS
        present += int(is_present)
        rows.append(AttendanceRow(
            user_id=uid, name=name, student_code=code, role="student", present=is_present,
            connected=bool(r and r.is_connected), first_joined_at=_utc(r.first_joined_at) if r else None,
            last_left_at=_utc(r.last_left_at) if r else None, total_seconds=total, join_count=r.join_count if r else 0,
        ))
    start = _utc(lc.started_at)
    end = _utc(lc.ended_at) or (now if lc.status == "live" else start)
    return AttendanceOut(
        live_class_id=lc.id, status=lc.status, started_at=start, ended_at=_utc(lc.ended_at),
        duration_seconds=int((end - start).total_seconds()) if start and end else 0,
        enrolled=len(enrolled), present=present, rows=rows,
    )


def _event_time(event: dict) -> datetime:
    ts = event.get("createdAt") or event.get("created_at")
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc)
    except (TypeError, ValueError):
        return _now()


def _handle_webhook(event: dict) -> None:
    kind = event.get("event")
    room = (event.get("room") or {}).get("name")
    if not room:
        return
    db = SessionLocal()
    try:
        lc = db.scalar(select(LiveClass).where(LiveClass.room_name == room))
        if not lc:
            return
        at = _event_time(event)
        if kind == "room_finished":
            if lc.status == "live":
                lc.status = "ended"
                lc.ended_at = at
                _finalize_attendance(db, lc, at)
                db.commit()
            return
        participant = event.get("participant") or {}
        uid = lk.user_id_from_identity(participant.get("identity"))
        if uid is None or kind not in ("participant_joined", "participant_left"):
            return
        role = "teacher" if uid == lc.teacher_id else "student"
        for attempt in range(3):
            row = db.scalar(select(LiveClassAttendance).where(
                LiveClassAttendance.live_class_id == lc.id, LiveClassAttendance.user_id == uid).with_for_update())
            if kind == "participant_joined":
                if row is None:
                    db.add(LiveClassAttendance(live_class_id=lc.id, user_id=uid, role=role, first_joined_at=at,
                                               last_joined_at=at, total_seconds=0, join_count=1, is_connected=True))
                elif not row.is_connected:
                    row.is_connected = True
                    row.last_joined_at = at
                    row.join_count += 1
            else:
                if row is not None and row.is_connected:
                    row.total_seconds += max(0, int((at - _utc(row.last_joined_at)).total_seconds()))
                    row.is_connected = False
                    row.last_left_at = at
            try:
                db.commit()
                return
            except IntegrityError:
                db.rollback()
    finally:
        db.close()


@router.post("/webhook", status_code=200, include_in_schema=False)
async def livekit_webhook(request: Request):
    body = await request.body()
    try:
        event = lk.verify_webhook(body, request.headers.get("Authorization"))
    except lk.LiveKitError as exc:
        raise HTTPException(exc.status or 401, "Invalid webhook")
    await asyncio.to_thread(_handle_webhook, event)
    return {"ok": True}