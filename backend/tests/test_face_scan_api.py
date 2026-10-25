
import base64
import io
import os
import tempfile
import time
import uuid

os.environ["ENABLE_AI"] = "false"
os.environ["ENABLE_FACE_ID"] = "false"
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(prefix="fs_"), "t.db")
os.environ["MEDIA_DIR"] = tempfile.mkdtemp(prefix="media_")

import pytest                                  
from fastapi import FastAPI               
from fastapi.testclient import TestClient      
from PIL import Image                     

from face_scan_sim import A, B, BASE, Sim   

from app.api import auth as auth_api, face_scan as fs_api  
from app.core.config import settings         
from app.core.security import hash_password, create_purpose_token 
from app.db.session import Base, SessionLocal, engine  
from app import models                        
from app.models.student import Student      
from app.models.user import Role, User    

Base.metadata.create_all(engine)
app = FastAPI()
app.include_router(auth_api.router, prefix="/api/v1")
app.include_router(fs_api.router, prefix="/api/v1")
client = TestClient(app)
PW = "Test@1234"

_buf = io.BytesIO()
Image.new("RGB", (160, 120), (120, 90, 60)).save(_buf, "JPEG")
FRAME = base64.b64encode(_buf.getvalue()).decode()


class FakeCamera:
    nxt = None

    def __call__(self, img, jpeg=None, t=None):
        obs, self.nxt = self.nxt, None
        return obs


CAM = FakeCamera()


@pytest.fixture(autouse=True)
def _fake_vision(monkeypatch):
    monkeypatch.setattr(fs_api, "observe_frame", CAM)
    monkeypatch.setattr(fs_api, "models_ready", lambda: True)
    monkeypatch.setattr(settings, "FACE_SCAN_REQUIRED_FOR_LOGIN", True)
    monkeypatch.setattr(settings, "FACE_SCAN_REQUIRED_FOR_REGISTER", True)
    monkeypatch.setattr(settings, "FACE_SCAN_ENROLL_ON_FIRST_LOGIN", True)
    fs_api.store._items.clear()
    fs_api.store._failures.clear()


class Remote(Sim):

    def __init__(self, who, seed=0):
        class _S:               
            steps, step_idx = [], 0
        super().__init__(_S(), who, seed=seed, t=time.monotonic())
        self.sid = None
        self.last = None

    def adopt(self, state):
        self.last = state
        class St:
            def __init__(s, d): s.kind, s.sector = d["kind"], d["sector"]
        self.s.steps = [St(d) for d in state["steps"]]
        self.s.step_idx = state["step_index"]

    def post_frame(self, **kw):
        step = self.s.steps[min(self.s.step_idx, len(self.s.steps) - 1)]
        class Catcher:
            def process(inner, obs):
                CAM.nxt = obs
                return {"status": "running", "code": "x"}
        real = self.s
        self.s = type("P", (), {"steps": real.steps, "step_idx": real.step_idx, "process": Catcher().process})()
        self.send(**kw)
        self.s = real
        r = client.post("/api/v1/auth/face-scan/frame", json={"session_id": self.sid, "image": FRAME})
        assert r.status_code == 200, r.text
        self.adopt(r.json())
        return r.json()

    def run_http(self, max_frames=250, events=None):
        events = events or {}
        res = self.last
        for i in range(max_frames):
            res = self.post_frame(**events.get(i, {}))
            if res["status"] != "running":
                break
        return res


def start_scan(purpose, who, scan_token=None, seed=0):
    r = client.post("/api/v1/auth/face-scan/start", json={"purpose": purpose, "scan_token": scan_token})
    assert r.status_code == 200, r.text
    sim = Remote(who, seed)
    sim.sid = r.json()["session_id"]
    sim.t = time.monotonic()
    sim.adopt(r.json()["frame"])
    return sim, r.json()


def make_student(**kw):
    tag = uuid.uuid4().hex[:8]
    with SessionLocal() as db:
        u = User(name="Stu", email=f"s_{tag}@t.io", password=hash_password(PW), role=Role.student)
        db.add(u); db.flush()
        db.add(Student(user_id=u.id, student_id=f"S-{tag}", department="d", session_label="x", **kw))
        db.commit()
        return u.email, u.id


def password_login(email):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return r.json()


def register(ticket, email=None, role="student"):
    email = email or f"r_{uuid.uuid4().hex[:8]}@t.io"
    return client.post("/api/v1/auth/register", json={
        "name": "New Student", "email": email, "password": PW, "role": role, "face_scan_ticket": ticket})


def enrolled_student():
    """Registers through the real flow and returns the account's email."""
    sim, _ = start_scan("register", A, seed=3)
    assert sim.run_http()["status"] == "passed"
    ticket = client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid}).json()["scan_ticket"]
    email = f"e_{uuid.uuid4().hex[:8]}@t.io"
    assert register(ticket, email).status_code == 201
    return email



def test_register_with_360_scan_saves_templates():
    sim, first = start_scan("register", A, seed=1)
    assert first["mode"] == "enroll"
    res = sim.run_http()
    assert res["status"] == "passed", res
    c = client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid})
    assert c.status_code == 200
    email = f"ok_{uuid.uuid4().hex[:6]}@t.io"
    r = register(c.json()["scan_ticket"], email)
    assert r.status_code == 201 and r.json()["role"] == "student"
    with SessionLocal() as db:
        prof = db.query(Student).join(User).filter(User.email == email).one()
        assert prof.registration_face_embedding and prof.registration_face_image
        assert len(prof.face_scan_templates["ring"]) == 8


def test_register_without_or_with_bad_ticket_is_refused():
    assert register(None).status_code == 400
    assert register("not-a-jwt").status_code == 400
    forged = create_purpose_token("abc", "student", 5, "access")        
    assert register(forged).status_code == 400
    unknown = create_purpose_token("nosuchsession", "student", 5, "face_scan_ticket")
    assert register(unknown).status_code == 400


def test_ticket_works_only_once():
    sim, _ = start_scan("register", A, seed=1)
    sim.run_http()
    ticket = client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid}).json()["scan_ticket"]
    assert register(ticket).status_code == 201
    assert register(ticket).status_code == 400


def test_register_cannot_complete_unfinished_scan():
    sim, _ = start_scan("register", A, seed=1)
    for _ in range(3):
        sim.post_frame()
    assert client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid}).status_code == 409


def test_teacher_registration_needs_no_scan():
    r = register(None, role="teacher")
    assert r.status_code == 201 and r.json()["role"] == "teacher"


def test_password_alone_gives_no_tokens_to_students():
    email = enrolled_student()
    body = password_login(email)
    assert body["requires_face_scan"] is True and body["scan_token"]
    assert not body.get("access_token") and not body.get("refresh_token")


def test_pending_token_is_useless_as_a_login():
    email = enrolled_student()
    pend = password_login(email)["scan_token"]
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {pend}"}).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": pend}).status_code == 401
    other = client.post("/api/v1/auth/login", json={"email": "x@y.io", "password": "z"})
    assert other.status_code == 401


def test_login_form_door_is_closed_for_students_but_open_for_teachers():
    email = enrolled_student()
    assert client.post("/api/v1/auth/login-form", data={"username": email, "password": PW}).status_code == 403
    t = register(None, role="teacher").json()
    with SessionLocal() as db:
        tm = db.query(User).filter(User.role == Role.teacher).first().email
    r = client.post("/api/v1/auth/login-form", data={"username": tm, "password": PW})
    assert r.status_code == 200 and r.json()["access_token"]


def test_teacher_login_unchanged():
    register(None, email="teach@t.io", role="teacher")
    b = password_login("teach@t.io")
    assert b["access_token"] and not b["requires_face_scan"]


def test_genuine_student_logs_in_after_scan():
    email = enrolled_student()
    pend = password_login(email)["scan_token"]
    sim, first = start_scan("login", A, pend, seed=21)
    assert first["mode"] == "verify"
    assert sim.run_http()["status"] == "passed"
    r = client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid})
    assert r.status_code == 200
    tok = r.json()["access_token"]
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert me.status_code == 200 and me.json()["email"] == email
    assert client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid}).status_code in (404, 409)


def test_other_person_cannot_log_in_even_with_the_password():
    email = enrolled_student()
    pend = password_login(email)["scan_token"]
    sim, _ = start_scan("login", B, pend, seed=5)
    res = sim.run_http()
    assert res["status"] == "failed" and res["code"] == "identity_mismatch"
    r = client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid})
    assert r.status_code == 409 and "access_token" not in r.text


def test_account_locks_after_repeated_failed_scans():
    email = enrolled_student()
    for i in range(settings.FACE_SCAN_MAX_FAILED_SESSIONS):
        pend = password_login(email)["scan_token"]
        sim, _ = start_scan("login", B, pend, seed=i)
        assert sim.run_http()["status"] == "failed"
    pend = password_login(email)["scan_token"]
    r = client.post("/api/v1/auth/face-scan/start", json={"purpose": "login", "scan_token": pend})
    assert r.status_code == 429


def test_swapping_person_during_login_is_blocked():
    email = enrolled_student()
    pend = password_login(email)["scan_token"]
    sim, _ = start_scan("login", A, pend, seed=9)
    while sim.s.step_idx < 4:
        sim.post_frame()
    sim.who = B
    res = sim.run_http()
    assert res["status"] == "failed"
    assert client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid}).status_code == 409


def test_second_face_during_login_restarts_scan():
    email = enrolled_student()
    pend = password_login(email)["scan_token"]
    sim, _ = start_scan("login", A, pend, seed=9)
    while sim.s.step_idx < 4:
        sim.post_frame()
    res = sim.post_frame(faces=2)
    assert res["code"] == "restart_multiple_faces" and res["step_index"] == 0 and res["restarts"] == 1


def test_start_login_needs_valid_pending_token():
    r = client.post("/api/v1/auth/face-scan/start", json={"purpose": "login", "scan_token": "junk"})
    assert r.status_code == 401
    r = client.post("/api/v1/auth/face-scan/start", json={"purpose": "login"})
    assert r.status_code == 401


def test_unknown_session_and_bad_image():
    r = client.post("/api/v1/auth/face-scan/frame", json={"session_id": "x" * 30, "image": FRAME})
    assert r.status_code == 404
    sim, _ = start_scan("register", A)
    r = client.post("/api/v1/auth/face-scan/frame", json={"session_id": sim.sid, "image": "A" * 200})
    assert r.status_code == 400



def test_legacy_single_photo_account_is_upgraded_then_verified():
    email, uid = make_student(registration_face_embedding=[float(x) for x in A])
    pend = password_login(email)["scan_token"]
    sim, first = start_scan("login", A, pend, seed=2)
    assert first["mode"] == "upgrade"
    assert sim.run_http()["status"] == "passed"
    assert client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid}).status_code == 200
    with SessionLocal() as db:
        assert len(db.query(Student).filter(Student.user_id == uid).one().face_scan_templates["ring"]) == 8
    pend = password_login(email)["scan_token"]
    _, again = start_scan("login", A, pend)
    assert again["mode"] == "verify"


def test_stranger_cannot_upgrade_someone_elses_legacy_account():
    email, _ = make_student(registration_face_embedding=[float(x) for x in A])
    pend = password_login(email)["scan_token"]
    sim, _ = start_scan("login", B, pend, seed=2)
    assert sim.run_http()["status"] == "failed"


def test_account_without_any_face_data_enrols_on_first_login(monkeypatch):
    email, uid = make_student()
    pend = password_login(email)["scan_token"]
    sim, first = start_scan("login", A, pend, seed=2)
    assert first["mode"] == "enroll"
    assert sim.run_http()["status"] == "passed"
    assert client.post("/api/v1/auth/face-scan/complete", json={"session_id": sim.sid}).status_code == 200
    with SessionLocal() as db:
        p = db.query(Student).filter(Student.user_id == uid).one()
        assert p.registration_face_embedding and p.face_scan_templates
    pend = password_login(email)["scan_token"]
    sim, first = start_scan("login", B, pend, seed=4)
    assert first["mode"] == "verify" and sim.run_http()["status"] == "failed"


def test_first_login_enrolment_can_be_disabled(monkeypatch):
    monkeypatch.setattr(settings, "FACE_SCAN_ENROLL_ON_FIRST_LOGIN", False)
    email, _ = make_student()
    pend = password_login(email)["scan_token"]
    assert client.post("/api/v1/auth/face-scan/start", json={"purpose": "login", "scan_token": pend}).status_code == 403


def test_switch_off_returns_old_behaviour(monkeypatch):
    monkeypatch.setattr(settings, "FACE_SCAN_REQUIRED_FOR_LOGIN", False)
    email, _ = make_student()
    b = password_login(email)
    assert b["access_token"] and not b["requires_face_scan"]


def test_models_unavailable_fails_closed(monkeypatch):
    monkeypatch.setattr(fs_api, "models_ready", lambda: False)
    r = client.post("/api/v1/auth/face-scan/start", json={"purpose": "register"})
    assert r.status_code == 503
