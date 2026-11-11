import asyncio
import socket
import threading
import time

from app.core.refs import ATTEMPT, EXAM, encode_ref
import pytest

from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.db.session import Base, engine, SessionLocal
from app.models.user import User, Role
from app.models.student import Student
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.exam import ExamSession
from app.models.attempt import ExamAttempt
from app.realtime.manager import ConnectionManager
from app.realtime import pipeline as pipeline_mod


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _seed():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    t = User(name="Teacher", email="t@rt.io", password=hash_password("x"), role=Role.teacher)
    db.add(t)
    db.flush()
    course = Course(title="RT", teacher_id=t.id)
    db.add(course)
    db.flush()
    exam = ExamSession(course_id=course.id, title="RT exam", duration_minutes=60, status="active",
                       security={"camera": False, "microphone": False, "screenShare": False, "identity": False, "liveness": False})
    db.add(exam)
    db.flush()
    students = []
    for i in range(2):
        u = User(name=f"Student {i}", email=f"s{i}@rt.io", password=hash_password("x"), role=Role.student)
        db.add(u)
        db.flush()
        st = Student(user_id=u.id, student_id=f"RT-{i}")
        db.add(st)
        db.flush()
        db.add(Enrollment(course_id=course.id, student_id=st.id))
        a = ExamAttempt(exam_id=exam.id, student_id=st.id, status="in_progress")
        db.add(a)
        db.flush()
        students.append({"attempt": encode_ref(ATTEMPT, a.id), "token": create_access_token(str(u.id), "student"), "code": st.student_id})
    db.commit()
    info = {"exam": encode_ref(EXAM, exam.id), "teacher": create_access_token(str(t.id), "teacher"), "students": students}
    db.close()
    return info


@pytest.fixture(scope="module")
def live_server():
    pytest.importorskip("aiohttp")
    import uvicorn
    from app.main import socket_app
    info = _seed()
    port = _free_port()
    config = uvicorn.Config(socket_app, host="127.0.0.1", port=port, log_level="error", lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 60
    while not server.started and time.time() < deadline:
        time.sleep(0.1)
    assert server.started
    yield f"http://127.0.0.1:{port}", info
    server.should_exit = True
    thread.join(timeout=20)


async def _client(url, events):
    import socketio
    c = socketio.AsyncClient(reconnection=False)

    @c.on("*")
    async def any_event(event, payload):
        events.append((event, payload))

    await c.connect(url, transports=["websocket"])
    return c


def test_students_only_receive_their_own_data(live_server):
    url, info = live_server
    s0, s1 = info["students"]

    async def scenario():
        e0, e1, ed = [], [], []
        c0 = await _client(url, e0)
        c1 = await _client(url, e1)
        dash = await _client(url, ed)
        assert (await c0.call("student:join", {"token": s0["token"], "attempt_id": s0["attempt"]}))["ok"]
        assert (await c1.call("student:join", {"token": s1["token"], "attempt_id": s1["attempt"]}))["ok"]
        assert (await dash.call("dashboard:join", {"token": info["teacher"], "exam_id": info["exam"]}))["ok"]
        await c0.emit("frame:screen", {"image": "data:image/jpeg;base64,AAAA"})
        await c0.emit("client:violation", {"type": "tab_switch"})
        await asyncio.sleep(1.5)
        for c in (c0, c1, dash):
            await c.disconnect()
        return e0, e1, ed

    e0, e1, ed = asyncio.run(scenario())
    names1 = [e for e, _ in e1]
    assert "frame:screen" not in names1 and "frame:webcam" not in names1
    assert all(p.get("student", {}).get("id") != s0["code"] for e, p in e1 if e == "alert")
    for e, p in e1:
        if e == "students:tick":
            assert [s["id"] for s in p] == [s1["code"]]
    assert any(e == "frame:screen" and p["studentId"] == s0["code"] for e, p in ed)
    assert any(e == "alert" and p["alert"]["type"] == "Tab Switched" for e, p in ed)
    assert any(e == "alert" and p["alert"]["type"] == "Tab Switched" for e, p in e0)
    for e, p in e0:
        if e == "students:tick":
            assert [s["id"] for s in p] == [s0["code"]]


def test_oversized_frames_are_rejected(live_server):
    url, info = live_server
    s0 = info["students"][0]

    async def scenario():
        ed, e0 = [], []
        c0 = await _client(url, e0)
        dash = await _client(url, ed)
        await c0.call("student:join", {"token": s0["token"], "attempt_id": s0["attempt"]})
        await dash.call("dashboard:join", {"token": info["teacher"], "exam_id": info["exam"]})
        await c0.emit("frame:screen", {"image": "x" * (settings.MAX_FRAME_CHARS + 10)})
        await asyncio.sleep(0.8)
        await c0.disconnect()
        await dash.disconnect()
        return ed

    ed = asyncio.run(scenario())
    assert not any(e == "frame:screen" for e, _ in ed)


def test_late_disconnect_of_old_socket_keeps_student_online():
    m = ConnectionManager()
    s = m.register(1, 1, "S-1", "S", 1, "")
    m.connect(1, "old-sid")
    m.connect(1, "new-sid")
    assert m.disconnect("old-sid") is None
    assert s.connected and s.sid == "new-sid"
    assert m.by_sid("new-sid") is s
    assert m.disconnect("new-sid") is s
    assert not s.connected


def test_pipeline_serial_per_student_keeps_cadence_and_newest_frame(monkeypatch):
    m = ConnectionManager()
    monkeypatch.setattr(pipeline_mod, "manager", m)
    monkeypatch.setattr(settings, "FRAME_SAMPLE_RATE", 3)
    in_flight = {"now": 0, "max": 0}
    processed = []

    def fake_job(s, image):
        in_flight["now"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["now"])
        time.sleep(0.15)
        in_flight["now"] -= 1
        processed.append(image)
        if image == "frame-boom":
            raise RuntimeError("model crashed")
        return {"attention": 90}, [], []

    monkeypatch.setattr(pipeline_mod, "process_frame_job", fake_job)
    p = pipeline_mod.FramePipeline()
    applied = []

    async def emit_alert(s, a, shot=None):
        pass

    p.bind(emit_alert, lambda exam_id: applied.append(exam_id))

    async def scenario():
        s = m.register(7, 3, "S-7", "S", 1, "")
        for i in range(1, 13):
            p.submit_webcam(s, f"frame-{i}")
            await asyncio.sleep(0.01)
        await asyncio.sleep(1.0)
        p.submit_webcam(s, "x1")
        p.submit_webcam(s, "x2")
        p.submit_webcam(s, "frame-boom")
        await asyncio.sleep(0.4)
        for i in range(3):
            p.submit_webcam(s, f"after-{i}")
        await asyncio.sleep(0.4)
        return s

    s = asyncio.run(scenario())
    assert in_flight["max"] == 1
    assert processed[0] == "frame-3"
    assert processed[1] == "frame-12"
    assert p.coalesced == 2
    assert "frame-boom" in processed and p.failed == 1
    assert processed[-1] == "after-2"
    assert s.analysis_count == len(processed) - 1

def test_phone_camera_pairing_relays_signaling_only_within_the_attempt(live_server):
    url, info = live_server
    s0, s1 = info["students"]

    async def scenario():
        host_ev, phone_ev, other_ev = [], [], []
        host = await _client(url, host_ev)
        phone = await _client(url, phone_ev)
        other = await _client(url, other_ev)

        res = await host.call("phone:host", {"token": s0["token"], "attempt_id": s0["attempt"]})
        assert res["ok"] and res["pair_token"]
        pair = res["pair_token"]

        # a pairing token must never act as a login token
        assert not (await other.call("student:join", {"token": pair, "attempt_id": s0["attempt"]}))["ok"]
        assert not (await other.call("phone:host", {"token": pair, "attempt_id": s0["attempt"]}))["ok"]
        # a student cannot host someone else's attempt, and a login token is not a pairing token
        assert not (await other.call("phone:host", {"token": s1["token"], "attempt_id": s0["attempt"]}))["ok"]
        assert not (await other.call("phone:join", {"pair_token": s0["token"]}))["ok"]

        assert (await phone.call("phone:join", {"pair_token": pair}))["ok"]
        await asyncio.sleep(0.3)
        assert ("phone:peer", {"connected": True}) in host_ev

        await host.emit("phone:signal", {"data": {"description": {"type": "offer", "sdp": "x"}}})
        await phone.emit("phone:signal", {"data": {"description": {"type": "answer", "sdp": "y"}}})
        await asyncio.sleep(0.3)
        assert any(e == "phone:signal" and p["data"]["description"]["type"] == "offer" for e, p in phone_ev)
        assert any(e == "phone:signal" and p["data"]["description"]["type"] == "answer" for e, p in host_ev)
        assert not any(e == "phone:signal" for e, _ in other_ev)

        await phone.disconnect()
        await asyncio.sleep(0.3)
        assert ("phone:peer", {"connected": False}) in host_ev
        await host.disconnect()
        await other.disconnect()

    asyncio.run(scenario())


def test_phone_pairing_is_allowed_during_checklist_but_not_after_submit(live_server):
    url, info = live_server
    s0 = info["students"][0]
    from app.models.attempt import ExamAttempt
    from app.core.refs import decode_ref

    def set_status(status):
        db = SessionLocal()
        try:
            db.get(ExamAttempt, decode_ref(ATTEMPT, s0["attempt"])).status = status
            db.commit()
        finally:
            db.close()

    async def scenario():
        c = await _client(url, [])
        set_status("checklist")
        assert (await c.call("phone:host", {"token": s0["token"], "attempt_id": s0["attempt"]}))["ok"]
        # ...but the exam stream itself still needs a started attempt
        assert not (await c.call("student:join", {"token": s0["token"], "attempt_id": s0["attempt"]}))["ok"]
        set_status("submitted")
        assert not (await c.call("phone:host", {"token": s0["token"], "attempt_id": s0["attempt"]}))["ok"]
        set_status("in_progress")
        await c.disconnect()

    asyncio.run(scenario())
