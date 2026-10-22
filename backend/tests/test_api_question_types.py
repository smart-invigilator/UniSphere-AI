"""
End-to-end test through the real HTTP API (needs a migrated PostgreSQL:
`alembic upgrade head`, same DATABASE_URL your app uses). Run:  pytest tests -q
Skipped automatically when the database is not reachable.
"""
import io
import json
import os
import tempfile
import uuid

import pytest

os.environ.setdefault("ENABLE_AI", "false")
os.environ.setdefault("ENABLE_FACE_ID", "false")
os.environ["MEDIA_DIR"] = tempfile.mkdtemp(prefix="media_test_")

from fastapi.testclient import TestClient   # noqa: E402
from PIL import Image                        # noqa: E402

from app.core.security import hash_password   # noqa: E402
from app.db.session import SessionLocal       # noqa: E402
from app.main import app                       # noqa: E402
from app.models.course import Course          # noqa: E402
from app.models.enrollment import Enrollment   # noqa: E402
from app.models.student import Student        # noqa: E402
from app.models.user import Role, User        # noqa: E402

try:
    with SessionLocal() as _db:
        _db.execute(__import__("sqlalchemy").text("select 1 from questions where false"))
        _db.execute(__import__("sqlalchemy").text("select answer_key from questions where false"))
    DB_OK = True
except Exception:
    DB_OK = False
pytestmark = pytest.mark.skipif(not DB_OK, reason="PostgreSQL with migration 0005 not available")

client = TestClient(app)
PW = "Test@1234"


def _login(email):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def world():
    tag = uuid.uuid4().hex[:8]
    with SessionLocal() as db:
        teacher = User(name="T", email=f"t_{tag}@qtest.io", password=hash_password(PW), role=Role.teacher)
        stu_u = User(name="S", email=f"s_{tag}@qtest.io", password=hash_password(PW), role=Role.student)
        db.add_all([teacher, stu_u]); db.flush()
        course = Course(teacher_id=teacher.id, title=f"C {tag}", subject="x", description="")
        prof = Student(user_id=stu_u.id, student_id=f"Q-{tag}", department="d", session_label="s", attendance=100)
        db.add_all([course, prof]); db.flush()
        db.add(Enrollment(course_id=course.id, student_id=prof.id, method="manual"))
        db.commit()
        ids = dict(course=course.id)
    return {"t": _login(f"t_{tag}@qtest.io"), "s": _login(f"s_{tag}@qtest.io"), **ids}


def _png(w=300, h=200):
    b = io.BytesIO(); Image.new("RGB", (w, h), (200, 30, 30)).save(b, "PNG"); return b.getvalue()


def test_full_flow(world):
    T, S = world["t"], world["s"]

    # ---------------------------------------------------------- image upload
    up = client.post("/api/v1/media/question-image", headers=T, files={"file": ("a.png", _png(), "image/png")})
    assert up.status_code == 201, up.text
    url = up.json()["url"]
    assert client.get(url).status_code == 200 and client.get(url).headers["content-type"] == "image/png"
    assert client.post("/api/v1/media/question-image", headers=T, files={"file": ("a.png", b"not an image", "image/png")}).status_code == 400
    assert client.post("/api/v1/media/question-image", headers=S, files={"file": ("a.png", _png(), "image/png")}).status_code == 403
    big = io.BytesIO(); Image.new("RGB", (4000, 3000), (1, 2, 3)).save(big, "PNG")
    r = client.post("/api/v1/media/question-image", headers=T, files={"file": ("big.png", big.getvalue(), "image/png")})
    assert r.status_code == 201 and max(r.json()["width"], r.json()["height"]) <= 1600     # downscaled

    # ------------------------------------------------------------ bad input
    bad = {"course_id": world["course"], "title": "bad exam", "questions": [{"type": "mcq", "text": "x", "options": ["a", "b"], "marks": 1}]}
    r = client.post("/api/v1/exams", headers=T, json=bad)
    assert r.status_code == 422 and "Question 1" in r.json()["detail"]

    # --------------------------------------------------- one of every type
    items = [{"id": f"i{n}", "text": f"step {n}"} for n in range(1, 5)]
    left = [{"id": "l1", "text": "AND"}, {"id": "l2", "text": "OR"}]
    right = [{"id": "r1", "text": "conjunction"}, {"id": "r2", "text": "disjunction"}, {"id": "r3", "text": "negation"}]
    Q = [
        dict(type="mcq", text="Pick B", options=["A", "B"], correct_answer="B", marks=2),                              # 0
        dict(type="tf", text="True?", correct_answer="True", marks=1),                                                   # 1
        dict(type="msq", text="Pick primes", options=["2", "3", "4", "9"], answer_key={"correct": ["2", "3"]}, marks=4),  # 2
        dict(type="fill_blank", text=r"Euler: $e^{i\pi}+[[1]]=0$ and [[2]]", answer_key={"blanks": [{"answers": ["1"]}, {"answers": ["done"]}]}, marks=4),  # 3
        dict(type="numeric", text="2+2?", answer_key={"value": 4, "tolerance": 0.01}, config={"unit": "units"}, marks=3),   # 4
        dict(type="math_expr", text="Derivative of $x^3$", answer_key={"expression": "3x^2"}, marks=5),                  # 5
        dict(type="matrix", text="Identity 2x2", answer_key={"matrix": [["1", "0"], ["0", "1"]]}, marks=4),              # 6
        dict(type="matching", text="Match", config={"left": left, "right": right}, answer_key={"pairs": {"l1": "r1", "l2": "r2"}}, marks=4),  # 7
        dict(type="ordering", text="Order", config={"items": items}, marks=4),                                           # 8
        dict(type="hotspot", text="Click the box", image_url=url, answer_key={"regions": [{"x": 10, "y": 10, "w": 30, "h": 30}]}, marks=2),   # 9
        dict(type="short", text="Which HCI heuristic is violated? $\\forall x$", image_url=url, marks=6),                # 10
        dict(type="essay", text="Discuss", config={"max_words": 300}, marks=10),                                         # 11
    ]
    total = sum(q["marks"] for q in Q)
    sec = {k: False for k in ("camera", "microphone", "screenShare", "identity", "liveness")}
    r = client.post("/api/v1/exams", headers=T, json={"course_id": world["course"], "title": "all types", "duration_minutes": 60, "security": sec, "questions": Q})
    assert r.status_code == 201, r.text
    exam = r.json(); assert exam["total_marks"] == total and exam["question_count"] == len(Q)
    assert client.post(f"/api/v1/exams/{exam['id']}/publish", headers=T).status_code == 200

    # ----------------------------------- teacher sees keys, student must not
    tq = client.get(f"/api/v1/exams/{exam['id']}/questions", headers=T).json()
    assert tq[2]["answer_key"] == {"correct": ["2", "3"]} and tq[8]["answer_key"]["order"] == ["i1", "i2", "i3", "i4"]

    att = client.post(f"/api/v1/exams/{exam['id']}/start", headers=S).json()
    assert client.post(f"/api/v1/attempts/{att['id']}/enter", headers=S).status_code == 200
    raw = client.get(f"/api/v1/exams/{exam['id']}/questions", headers=S)
    sq = raw.json()
    for leak in ("answer_key", "correct_answer", '"pairs"', '"order":["', '"blanks"', '"regions"', "3x^2"):
        assert leak not in raw.text, f"student response leaks {leak}"
    assert [q["type"] for q in sq] == [q["type"] for q in Q]
    assert sq[9]["image_url"] == url and sq[4]["config"]["unit"] == "units" and sq[6]["config"] == {"rows": 2, "cols": 2, "scoring": "partial"}
    assert [i["id"] for i in sq[8]["config"]["items"]] != ["i1", "i2", "i3", "i4"]          # shuffled
    sq2 = client.get(f"/api/v1/exams/{exam['id']}/questions", headers=S).json()
    assert sq2[8]["config"] == sq[8]["config"] and sq2[7]["config"] == sq[7]["config"]       # stable on reload

    # --------------------------------------------------------- answer + submit
    qid = [q["id"] for q in sq]
    answers = {
        0: "B",                                          # 2 / 2
        1: "False",                                      # 0 / 1
        2: json.dumps(["2"]),                            # 2 / 4 (partial)
        3: json.dumps(["1", "wrong"]),                   # 2 / 4 (partial)
        4: "4.005",                                      # 3 / 3 (within tolerance)
        5: "3*x*x",                                      # 5 / 5 (equivalent expression)
        6: json.dumps([["1", "0"], ["1", "1"]]),         # 3 / 4
        7: json.dumps({"l1": "r1", "l2": "r3"}),         # 2 / 4
        8: json.dumps(["i1", "i2", "i4", "i3"]),         # 2 / 4
        9: json.dumps({"x": 20, "y": 20}),               # 2 / 2
        10: "Visibility of system status",               # manual
        11: "A long essay",                              # manual
    }
    for i, resp in answers.items():
        r = client.post(f"/api/v1/attempts/{att['id']}/answer", headers=S, json={"question_id": qid[i], "response": resp})
        assert r.status_code == 200, r.text
    assert client.post(f"/api/v1/attempts/{att['id']}/answer", headers=S, json={"question_id": qid[0], "response": "x" * 20001}).status_code == 422

    sub = client.post(f"/api/v1/attempts/{att['id']}/submit", headers=S).json()
    expected_auto = 2 + 0 + 2 + 2 + 3 + 5 + 3 + 2 + 2 + 2
    assert sub["auto_score"] == expected_auto, sub
    assert sub["ungraded_questions"] == 2 and sub["status"] == "submitted" and sub["total_marks"] == total

    # --------------------------------------------------------------- grading
    aid = att["id"]
    assert client.post(f"/api/v1/attempts/{aid}/grade/{qid[10]}", headers=T, json={"marks_awarded": 5, "feedback": "ok"}).status_code == 200
    r = client.post(f"/api/v1/attempts/{aid}/grade/{qid[11]}", headers=T, json={"marks_awarded": 8, "feedback": ""})
    a = client.get(f"/api/v1/attempts/{aid}", headers=T).json()
    assert a["status"] == "graded" and a["final_score"] == expected_auto + 5 + 8

    # teacher overrides an auto-graded answer (msq 2/4 -> 4/4): totals stay consistent
    assert client.post(f"/api/v1/attempts/{aid}/grade/{qid[2]}", headers=T, json={"marks_awarded": 4, "feedback": "accepted"}).status_code == 200
    a = client.get(f"/api/v1/attempts/{aid}", headers=T).json()
    assert a["final_score"] == expected_auto - 2 + 5 + 8 + 4 and a["status"] == "graded"
    raw_answers = {x["question_id"]: x["response"] for x in client.get(f"/api/v1/attempts/{aid}/answers", headers=T).json()}
    assert raw_answers[qid[8]] == json.dumps(["i1", "i2", "i4", "i3"])

    # Bulk grading saves every question together and enforces each question's
    # individual maximum without partially changing the attempt.
    question_rows = client.get(f"/api/v1/exams/{eid}/questions", headers=T).json()
    answer_rows = client.get(f"/api/v1/attempts/{aid}/answers", headers=T).json()
    answer_by_question = {answer["question_id"]: answer for answer in answer_rows}
    grades = [
        {
            "question_id": question["id"],
            "marks_awarded": answer_by_question[question["id"]]["marks_awarded"],
            "feedback": answer_by_question[question["id"]]["feedback"],
        }
        for question in question_rows
    ]
    grades[0]["marks_awarded"] = question_rows[0]["marks"] + 1
    assert client.post(
        f"/api/v1/attempts/{aid}/grade", headers=T, json={"grades": grades}
    ).status_code == 422
    grades[0]["marks_awarded"] = -1
    assert client.post(
        f"/api/v1/attempts/{aid}/grade", headers=T, json={"grades": grades}
    ).status_code == 422
    grades[0]["marks_awarded"] = answer_by_question[question_rows[0]["id"]]["marks_awarded"]
    r = client.post(f"/api/v1/attempts/{aid}/grade", headers=T, json={"grades": grades})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "graded"


def test_update_draft_replaces_questions_and_old_exams_still_work(world):
    T = world["t"]
    r = client.post("/api/v1/exams", headers=T, json={"course_id": world["course"], "title": "legacy shape",
        "questions": [{"type": "mcq", "text": "old style", "options": ["a", "b"], "correct_answer": "a", "marks": 1},
                      {"type": "short", "text": "old short", "marks": 2}]})
    assert r.status_code == 201, r.text      # old payload shape (no config / key / image) still accepted
    eid = r.json()["id"]
    r = client.patch(f"/api/v1/exams/{eid}", headers=T, json={"title": "legacy shape v2", "questions": [
        {"type": "numeric", "text": "n", "answer_key": {"value": 1}, "marks": 1}]})
    assert r.status_code == 200 and r.json()["question_count"] == 1
