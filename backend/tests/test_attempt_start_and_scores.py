import json
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from app.api import exams as exams_api
from app.models.attempt import ExamAttempt
from app.services.answer_document import FORMAT
from tests.conftest import start_attempt


def make_exam(w):
    qs = [
        {"type": "mcq", "text": "m", "options": ["a", "b"], "correct_answer": "a", "marks": 4},
        {"type": "short", "text": "s", "marks": 5},
        {"type": "essay", "text": "e", "marks": 10},
    ]
    r = w["client"].post("/api/v1/exams", headers=w["T"], json={"course_id": w["course_id"], "title": "Scores", "questions": qs})
    eid = r.json()["id"]
    w["client"].post(f"/api/v1/exams/{eid}/publish", headers=w["T"])
    ids = [q["id"] for q in w["client"].get(f"/api/v1/exams/{eid}/questions", headers=w["T"]).json()]
    return eid, ids


def doc(text):
    return json.dumps({"format": FORMAT, "schema_version": 1, "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}})


def test_start_survives_duplicate_insert_race(world, monkeypatch):
    eid, _ = make_exam(world)
    db = world["db"]
    db.add(ExamAttempt(exam_id=eid, student_id=world["student_pk"], status="checklist"))
    db.commit()
    real_select = exams_api.select
    calls = {"n": 0}

    def first_lookup_misses(*args):
        query = real_select(*args)
        if args and args[0] is ExamAttempt:
            calls["n"] += 1
            if calls["n"] == 1:
                return query.where(sa.false())
        return query

    monkeypatch.setattr(exams_api, "select", first_lookup_misses)
    r = world["client"].post(f"/api/v1/exams/{eid}/start", headers=world["S"])
    assert r.status_code == 200, r.text
    assert calls["n"] >= 2
    monkeypatch.setattr(exams_api, "select", real_select)
    rows = db.scalars(sa.select(ExamAttempt).where(ExamAttempt.exam_id == eid)).all()
    assert len(rows) == 1 and r.json()["id"] == rows[0].id


def test_repeated_start_returns_same_attempt(world):
    eid, _ = make_exam(world)
    a = world["client"].post(f"/api/v1/exams/{eid}/start", headers=world["S"]).json()
    b = world["client"].post(f"/api/v1/exams/{eid}/start", headers=world["S"]).json()
    assert a["id"] == b["id"]


def test_student_sees_partial_then_final_score(world):
    eid, ids = make_exam(world)
    aid = start_attempt(world, eid)
    c = world["client"]
    c.post(f"/api/v1/attempts/{aid}/answer", headers=world["S"], json={"question_id": ids[0], "response": "a"})
    c.post(f"/api/v1/attempts/{aid}/answer", headers=world["S"], json={"question_id": ids[1], "response": doc("short")})
    c.post(f"/api/v1/attempts/{aid}/answer", headers=world["S"], json={"question_id": ids[2], "response": doc("long")})
    c.post(f"/api/v1/attempts/{aid}/submit", headers=world["S"])

    mine = {e["id"]: e for e in c.get("/api/v1/exams/mine", headers=world["S"]).json()}[eid]
    assert mine["my_attempt_status"] == "submitted"
    assert mine["my_auto_score"] == 4 and mine["my_final_score"] is None and mine["my_pending_grading"] == 2

    c.post(f"/api/v1/attempts/{aid}/grade/{ids[1]}", headers=world["T"], json={"marks_awarded": 3})
    mine = {e["id"]: e for e in c.get("/api/v1/exams/mine", headers=world["S"]).json()}[eid]
    assert mine["my_manual_score"] == 3 and mine["my_pending_grading"] == 1 and mine["my_final_score"] is None

    c.post(f"/api/v1/attempts/{aid}/grade/{ids[2]}", headers=world["T"], json={"marks_awarded": 7.5})
    mine = {e["id"]: e for e in c.get("/api/v1/exams/mine", headers=world["S"]).json()}[eid]
    assert mine["my_attempt_status"] == "graded"
    assert mine["my_final_score"] == 14.5 and mine["my_pending_grading"] == 0


def test_unhandled_errors_keep_cors_headers():
    from app.main import CatchServerErrors
    app = FastAPI()

    @app.get("/boom")
    def boom():
        raise RuntimeError("database exploded")

    app.add_middleware(CatchServerErrors)
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    r = TestClient(app, raise_server_exceptions=False).get("/boom", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 500
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "try again" in r.json()["detail"]