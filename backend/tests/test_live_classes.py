import base64
import hashlib
import json
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.db.session import Base, engine, SessionLocal
from app.models.user import User, Role
from app.models.student import Student
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.live_class import LiveClassAttendance
from app.api import live_classes as lc_api
from app.services import livekit as lk


class FakeLiveKit:
    def __init__(self):
        self.calls = []
        self.participants = {}

    def install(self, monkeypatch):
        for name in ("create_room", "delete_room", "update_room_metadata", "remove_participant",
                     "mute_published_track", "update_participant", "send_data"):
            monkeypatch.setattr(lk, name, self._recorder(name))
        monkeypatch.setattr(lk, "list_participants", lambda room: list(self.participants.get(room, [])))

    def _recorder(self, name):
        def fn(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return {}
        return fn

    def of(self, name):
        return [c for c in self.calls if c[0] == name]


@pytest.fixture()
def live(monkeypatch):
    monkeypatch.setattr(settings, "LIVEKIT_URL", "ws://livekit.test:7880")
    monkeypatch.setattr(settings, "LIVEKIT_API_KEY", "testkey")
    monkeypatch.setattr(settings, "LIVEKIT_API_SECRET", "testsecret-0123456789")
    for limiter in (lc_api.chat_limiter, lc_api.reaction_limiter, lc_api.state_limiter, lc_api.moderation_limiter):
        limiter._buckets.clear()
    fake = FakeLiveKit()
    fake.install(monkeypatch)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    teacher = User(name="Teacher T", email="t@lc.io", password=hash_password("x"), role=Role.teacher)
    other_teacher = User(name="Other T", email="o@lc.io", password=hash_password("x"), role=Role.teacher)
    db.add_all([teacher, other_teacher])
    db.flush()
    course = Course(title="Algorithms", teacher_id=teacher.id)
    other_course = Course(title="History", teacher_id=other_teacher.id)
    db.add_all([course, other_course])
    db.flush()
    students = []
    for i, enrolled in enumerate((True, True, False)):
        u = User(name=f"Student {i}", email=f"s{i}@lc.io", password=hash_password("x"), role=Role.student)
        db.add(u)
        db.flush()
        st = Student(user_id=u.id, student_id=f"LC-{i}")
        db.add(st)
        db.flush()
        if enrolled:
            db.add(Enrollment(course_id=course.id, student_id=st.id))
        students.append(u.id)
    db.commit()
    app = FastAPI()
    app.include_router(lc_api.router, prefix="/api/v1")
    hdr = lambda uid, role: {"Authorization": "Bearer " + create_access_token(str(uid), role)}
    ctx = {
        "client": TestClient(app), "fake": fake, "db": db, "course": course.id, "other_course": other_course.id,
        "T": hdr(teacher.id, "teacher"), "OT": hdr(other_teacher.id, "teacher"),
        "S0": hdr(students[0], "student"), "S1": hdr(students[1], "student"), "SX": hdr(students[2], "student"),
        "teacher_id": teacher.id, "students": students,
    }
    yield ctx
    db.close()


def create(ctx, start_now=True, **extra):
    body = {"course_id": ctx["course"], "title": "Graphs live", "description": "BFS/DFS", "start_now": start_now, **extra}
    r = ctx["client"].post("/api/v1/live-classes", headers=ctx["T"], json=body)
    assert r.status_code == 201, r.text
    return r.json()


def signed_webhook(event: dict):
    body = json.dumps(event).encode()
    digest = base64.b64encode(hashlib.sha256(body).digest()).decode()
    token = jwt.encode({"iss": settings.LIVEKIT_API_KEY, "sha256": digest, "exp": int(time.time()) + 300},
                       settings.LIVEKIT_API_SECRET, algorithm="HS256")
    return body, {"Authorization": token, "Content-Type": "application/webhook+json"}


def test_teacher_creates_and_starts_class(live):
    c = live["client"]
    scheduled = create(live, start_now=False, scheduled_start=(datetime.now(timezone.utc) + timedelta(hours=2)).isoformat())
    assert scheduled["status"] == "scheduled" and len(scheduled["meeting_code"]) == 12
    assert not live["fake"].of("create_room")
    r = c.post(f"/api/v1/live-classes/{scheduled['id']}/start", headers=live["T"])
    assert r.status_code == 200 and r.json()["status"] == "live"
    room = live["fake"].of("create_room")[0][1]
    assert room[0].startswith("lc-") and room[1]["chat_enabled"] is True and "grants" not in room[1]


def test_scheduling_validation(live):
    r = live["client"].post("/api/v1/live-classes", headers=live["T"], json={"course_id": live["course"], "title": "No time"})
    assert r.status_code == 422
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    r = live["client"].post("/api/v1/live-classes", headers=live["T"], json={"course_id": live["course"], "title": "Past", "scheduled_start": past})
    assert r.status_code == 422


def test_only_course_teacher_can_create_or_manage(live):
    r = live["client"].post("/api/v1/live-classes", headers=live["OT"], json={"course_id": live["course"], "title": "Hijack", "start_now": True})
    assert r.status_code == 403
    lc = create(live)
    for path in ("start", "end"):
        assert live["client"].post(f"/api/v1/live-classes/{lc['id']}/{path}", headers=live["OT"]).status_code == 403
    assert live["client"].post(f"/api/v1/live-classes/{lc['id']}/end", headers=live["S0"]).status_code == 403
    assert live["client"].patch(f"/api/v1/live-classes/{lc['id']}/settings", headers=live["S0"], json={"locked": True}).status_code == 403


def test_students_see_only_enrolled_classes_and_cannot_join_others(live):
    lc = create(live)
    mine = live["client"].get("/api/v1/live-classes/mine", headers=live["S0"]).json()
    assert [x["id"] for x in mine] == [lc["id"]]
    assert live["client"].get("/api/v1/live-classes/mine", headers=live["SX"]).json() == []
    assert live["client"].post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["SX"]).status_code == 403
    assert live["client"].get(f"/api/v1/live-classes/by-code/{lc['meeting_code']}", headers=live["SX"]).status_code == 403
    assert live["client"].get(f"/api/v1/live-classes/by-code/{lc['meeting_code'].upper()}", headers=live["S0"]).json()["id"] == lc["id"]


def test_join_tokens_carry_role_based_permissions(live):
    lc = create(live)
    t = live["client"].post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["T"]).json()
    tv = jwt.get_unverified_claims(t["token"])
    assert tv["video"]["room"].startswith("lc-") and tv["sub"] == f"u{live['teacher_id']}"
    assert set(tv["video"]["canPublishSources"]) == {"camera", "microphone", "screen_share", "screen_share_audio"}
    assert tv["video"]["canPublishData"] is False and tv["video"]["canUpdateOwnMetadata"] is False
    assert tv["exp"] - tv["nbf"] <= settings.LIVE_TOKEN_TTL_SECONDS + 10
    s = live["client"].post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["S0"]).json()
    sv = jwt.get_unverified_claims(s["token"])
    assert set(sv["video"]["canPublishSources"]) == {"camera", "microphone"}
    assert json.loads(sv["metadata"])["role"] == "student" and s["url"] == "ws://livekit.test:7880"
    jwt.decode(s["token"], settings.LIVEKIT_API_SECRET, algorithms=["HS256"], issuer=settings.LIVEKIT_API_KEY, options={"verify_aud": False})


def test_join_rules_not_started_ended_locked_removed(live):
    c = live["client"]
    sched = create(live, start_now=False, scheduled_start=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat())
    assert c.post(f"/api/v1/live-classes/{sched['id']}/join", headers=live["S0"]).status_code == 409
    lc = create(live)
    assert c.post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["S0"]).status_code == 200
    body, headers = signed_webhook({"event": "participant_joined", "room": {"name": live["fake"].of("create_room")[-1][1][0]},
                                    "participant": {"identity": f"u{live['students'][0]}"}, "createdAt": int(time.time())})
    assert c.post("/api/v1/live-classes/webhook", content=body, headers=headers).status_code == 200
    c.patch(f"/api/v1/live-classes/{lc['id']}/settings", headers=live["T"], json={"locked": True})
    assert c.post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["S1"]).status_code == 403
    assert c.post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["S0"]).status_code == 200
    assert c.post(f"/api/v1/live-classes/{lc['id']}/participants/{live['students'][0]}/remove", headers=live["T"]).status_code == 204
    assert live["fake"].of("remove_participant")[-1][1][1] == f"u{live['students'][0]}"
    r = c.post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["S0"])
    assert r.status_code == 403 and "removed" in r.json()["detail"]
    c.post(f"/api/v1/live-classes/{lc['id']}/participants/{live['students'][0]}/readmit", headers=live["T"])
    assert c.post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["S0"]).status_code == 200
    assert c.post(f"/api/v1/live-classes/{lc['id']}/end", headers=live["T"]).status_code == 200
    assert live["fake"].of("delete_room")
    assert c.post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["S0"]).status_code == 410


def test_permission_changes_apply_live(live):
    c = live["client"]
    lc = create(live)
    room = live["fake"].of("create_room")[-1][1][0]
    s0, s1 = live["students"][:2]
    live["fake"].participants[room] = [
        {"identity": f"u{s0}", "attributes": {"role": "student"}, "tracks": [{"sid": "TR_a", "source": "MICROPHONE", "muted": False}]},
        {"identity": f"u{s1}", "attributes": {"role": "student"}, "tracks": [{"sid": "TR_b", "source": "MICROPHONE", "muted": True}]},
        {"identity": f"u{live['teacher_id']}", "attributes": {"role": "teacher"}, "tracks": [{"sid": "TR_t", "source": "MICROPHONE", "muted": False}]},
    ]
    r = c.patch(f"/api/v1/live-classes/{lc['id']}/settings", headers=live["T"], json={"allow_student_mic": False, "chat_enabled": False})
    assert r.json()["allow_student_mic"] is False and r.json()["chat_enabled"] is False
    updates = {call[1][1]: call[2]["sources"] for call in live["fake"].of("update_participant")}
    assert updates == {f"u{s0}": ["camera"], f"u{s1}": ["camera"]}
    meta = live["fake"].of("update_room_metadata")[-1][1][1]
    assert meta["chat_enabled"] is False and "grants" not in meta and "removed" not in meta
    r = c.post(f"/api/v1/live-classes/{lc['id']}/participants/{s0}/permissions", headers=live["T"], json={"microphone": True, "screen": True})
    assert r.json()["sources"] == ["microphone", "camera", "screen_share", "screen_share_audio"]
    last = live["fake"].of("update_participant")[-1]
    assert last[1][1] == f"u{s0}" and last[2]["attributes"] == {"request": ""}
    sv = jwt.get_unverified_claims(c.post(f"/api/v1/live-classes/{lc['id']}/join", headers=live["S0"]).json()["token"])
    assert "screen_share" in sv["video"]["canPublishSources"]
    live["fake"].calls.clear()
    assert c.post(f"/api/v1/live-classes/{lc['id']}/mute-all", headers=live["T"]).status_code == 204
    muted = [(call[1][1], call[1][2]) for call in live["fake"].of("mute_published_track")]
    assert muted == [(f"u{s0}", "TR_a")]
    assert c.post(f"/api/v1/live-classes/{lc['id']}/mute-all", headers=live["S0"]).status_code == 403


def test_chat_questions_reactions_and_rate_limits(live):
    c = live["client"]
    lc = create(live)
    r = c.post(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["S0"], json={"text": "  Hello ünïcode <b>x</b>  "})
    assert r.status_code == 201 and r.json()["text"] == "Hello ünïcode <b>x</b>" and r.json()["role"] == "student"
    topic, payload = live["fake"].of("send_data")[-1][1][1], live["fake"].of("send_data")[-1][1][2]
    assert topic == "lc.message" and payload["text"] == "Hello ünïcode <b>x</b>"
    q = c.post(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["S1"], json={"kind": "question", "text": "What is BFS?"}).json()
    assert c.post(f"/api/v1/live-classes/{lc['id']}/messages/{q['id']}/answer", headers=live["S1"]).status_code == 403
    assert c.post(f"/api/v1/live-classes/{lc['id']}/messages/{q['id']}/answer", headers=live["T"]).json()["answered"] is True
    hidden = c.post(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["S0"], json={"text": "spam"}).json()
    c.post(f"/api/v1/live-classes/{lc['id']}/messages/{hidden['id']}/hide", headers=live["T"])
    student_view = [m["text"] for m in c.get(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["S1"]).json()]
    teacher_view = [m["text"] for m in c.get(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["T"]).json()]
    assert "spam" not in student_view and "spam" in teacher_view and student_view[0].startswith("Hello")
    c.patch(f"/api/v1/live-classes/{lc['id']}/settings", headers=live["T"], json={"chat_enabled": False})
    assert c.post(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["S0"], json={"text": "hi"}).status_code == 403
    assert c.post(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["T"], json={"text": "teacher still can"}).status_code == 201
    assert c.post(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["S0"], json={"kind": "question", "text": "Q allowed"}).status_code == 201
    assert c.post(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["SX"], json={"text": "outsider"}).status_code == 403
    assert c.post(f"/api/v1/live-classes/{lc['id']}/messages", headers=live["S0"], json={"text": "x" * 1001}).status_code == 422
    assert c.post(f"/api/v1/live-classes/{lc['id']}/reactions", headers=live["S0"], json={"emoji": "👍"}).status_code == 204
    assert live["fake"].of("send_data")[-1][2]["reliable"] is False
    assert c.post(f"/api/v1/live-classes/{lc['id']}/reactions", headers=live["S0"], json={"emoji": "<script>"}).status_code == 422
    codes = [c.post(f"/api/v1/live-classes/{lc['id']}/reactions", headers=live["S1"], json={"emoji": "🎉"}).status_code for _ in range(20)]
    assert 429 in codes


def test_hand_raise_and_requests_use_server_side_attributes(live):
    c = live["client"]
    lc = create(live)
    assert c.post(f"/api/v1/live-classes/{lc['id']}/hand", headers=live["S0"], json={"raised": True}).status_code == 204
    call = live["fake"].of("update_participant")[-1]
    assert call[1][1] == f"u{live['students'][0]}" and call[2]["attributes"]["hand"] != ""
    c.post(f"/api/v1/live-classes/{lc['id']}/request", headers=live["S0"], json={"kind": "screen"})
    assert live["fake"].of("update_participant")[-1][2]["attributes"] == {"request": "screen"}
    assert c.post(f"/api/v1/live-classes/{lc['id']}/request", headers=live["S0"], json={"kind": "admin"}).status_code == 422
    c.post(f"/api/v1/live-classes/{lc['id']}/participants/{live['students'][0]}/lower-hand", headers=live["T"])
    assert live["fake"].of("update_participant")[-1][2]["attributes"] == {"hand": "", "request": ""}


def test_attendance_from_signed_webhooks_without_duplicates(live):
    c = live["client"]
    lc = create(live)
    room = live["fake"].of("create_room")[-1][1][0]
    s0 = live["students"][0]
    t0 = int(time.time()) - 600

    def send(event, offset, identity=f"u{s0}"):
        body, headers = signed_webhook({"event": event, "room": {"name": room}, "participant": {"identity": identity}, "createdAt": t0 + offset})
        return c.post("/api/v1/live-classes/webhook", content=body, headers=headers)

    assert send("participant_joined", 0).status_code == 200
    assert send("participant_joined", 5).status_code == 200
    assert send("participant_left", 120).status_code == 200
    assert send("participant_left", 125).status_code == 200
    assert send("participant_joined", 130).status_code == 200
    assert send("participant_left", 190).status_code == 200
    db = SessionLocal()
    rows = db.query(LiveClassAttendance).filter_by(live_class_id=lc["id"], user_id=s0).all()
    db.close()
    assert len(rows) == 1 and rows[0].join_count == 2 and rows[0].total_seconds == 180 and rows[0].is_connected is False
    report = c.get(f"/api/v1/live-classes/{lc['id']}/attendance", headers=live["T"]).json()
    assert report["enrolled"] == 2 and report["present"] == 1
    by_id = {r["user_id"]: r for r in report["rows"]}
    assert by_id[s0]["present"] is True and by_id[s0]["total_seconds"] == 180 and by_id[live["students"][1]]["present"] is False
    assert c.get(f"/api/v1/live-classes/{lc['id']}/attendance", headers=live["S0"]).status_code == 403


def test_webhook_rejects_forged_or_tampered_requests(live):
    c = live["client"]
    body, headers = signed_webhook({"event": "participant_joined", "room": {"name": "x"}, "participant": {"identity": "u1"}})
    assert c.post("/api/v1/live-classes/webhook", content=body + b" ", headers=headers).status_code == 401
    forged = jwt.encode({"iss": settings.LIVEKIT_API_KEY, "sha256": "x"}, "wrong-secret", algorithm="HS256")
    assert c.post("/api/v1/live-classes/webhook", content=body, headers={"Authorization": forged}).status_code == 401
    assert c.post("/api/v1/live-classes/webhook", content=body).status_code == 401


def test_end_finalizes_attendance_and_room_finished_auto_ends(live):
    c = live["client"]
    lc = create(live)
    room = live["fake"].of("create_room")[-1][1][0]
    body, headers = signed_webhook({"event": "participant_joined", "room": {"name": room}, "participant": {"identity": f"u{live['students'][1]}"}, "createdAt": int(time.time()) - 90})
    c.post("/api/v1/live-classes/webhook", content=body, headers=headers)
    assert c.post(f"/api/v1/live-classes/{lc['id']}/end", headers=live["T"]).json()["status"] == "ended"
    row = c.get(f"/api/v1/live-classes/{lc['id']}/attendance", headers=live["T"]).json()["rows"]
    s1 = next(r for r in row if r["user_id"] == live["students"][1])
    assert s1["connected"] is False and s1["total_seconds"] >= 89
    lc2 = create(live)
    room2 = live["fake"].of("create_room")[-1][1][0]
    body, headers = signed_webhook({"event": "room_finished", "room": {"name": room2}, "createdAt": int(time.time())})
    c.post("/api/v1/live-classes/webhook", content=body, headers=headers)
    assert c.get(f"/api/v1/live-classes/{lc2['id']}", headers=live["T"]).json()["status"] == "ended"


def test_not_configured_gives_clear_error(live, monkeypatch):
    monkeypatch.setattr(settings, "LIVEKIT_API_KEY", "")
    lc = live["client"].post("/api/v1/live-classes", headers=live["T"], json={"course_id": live["course"], "title": "x" * 3,
                                                                              "scheduled_start": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}).json()
    monkeypatch.setattr(lk, "create_room", lambda *a, **k: (_ for _ in ()).throw(lk.LiveKitNotConfigured("nope")))
    r = live["client"].post(f"/api/v1/live-classes/{lc['id']}/start", headers=live["T"])
    assert r.status_code == 503 and "not set up" in r.json()["detail"]