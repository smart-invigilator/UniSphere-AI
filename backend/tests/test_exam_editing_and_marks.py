import json
from app.services.answer_document import FORMAT
from tests.conftest import start_attempt


def doc(content):
    return json.dumps({"format": FORMAT, "schema_version": 1, "doc": {"type": "doc", "content": content}})


TABLE_AND_DIAGRAM = doc([
    {"type": "paragraph", "content": [{"type": "text", "text": "Hint: use this table"}]},
    {"type": "table", "content": [{"type": "tableRow", "content": [
        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}]},
        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "mathInline", "attrs": {"latex": "x^2"}}]}]},
    ]}]},
    {"type": "diagram", "attrs": {"scene": {"elements": [{"id": "r", "type": "rectangle", "x": 0, "y": 0, "width": 10, "height": 10}]}}},
])

QUESTIONS = [
    {"type": "short", "text": "Explain", "marks": 5, "settings": {"rich_content": TABLE_AND_DIAGRAM}},
    {"type": "mcq", "text": "Pick", "options": ["a", "b"], "correct_answer": "a", "marks": 2},
]


def create(w, questions=QUESTIONS, publish=True):
    r = w["client"].post("/api/v1/exams", headers=w["T"], json={"course_id": w["course_id"], "title": "Edit me", "questions": questions})
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    if publish:
        w["client"].post(f"/api/v1/exams/{eid}/publish", headers=w["T"])
    return eid


def test_rich_question_content_saved_and_shown_to_students(world):
    eid = create(world)
    tq = world["client"].get(f"/api/v1/exams/{eid}/questions", headers=world["T"]).json()
    content = json.loads(tq[0]["settings"]["rich_content"])["doc"]["content"]
    assert [n["type"] for n in content] == ["paragraph", "table", "diagram"]
    start_attempt(world, eid)
    sq = world["client"].get(f"/api/v1/exams/{eid}/questions", headers=world["S"]).json()
    assert json.loads(sq[0]["settings"]["rich_content"])["doc"]["content"] == content
    assert "rich_content" not in sq[1]["settings"]


def test_malicious_rich_question_content_rejected(world):
    bad = doc([{"type": "diagram", "attrs": {"scene": {"elements": [{"id": "e", "type": "embeddable", "link": "javascript:alert(1)"}]}}}])
    r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "Bad", "questions": [
        {"type": "short", "text": "x", "marks": 1, "settings": {"rich_content": bad}}]})
    assert r.status_code == 422 and "Question content" in r.text
    r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "Bad", "questions": [
        {"type": "short", "text": "x", "marks": 1, "settings": {"rich_content": "<script>alert(1)</script>"}}]})
    assert r.status_code == 422


def test_published_exam_fully_editable_until_students_start(world):
    eid = create(world)
    new_qs = QUESTIONS + [{"type": "tf", "text": "True?", "options": ["True", "False"], "correct_answer": "True", "marks": 3}]
    r = world["client"].patch(f"/api/v1/exams/{eid}", headers=world["T"], json={"title": "Edited", "duration_minutes": 90, "questions": new_qs})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "Edited" and body["question_count"] == 3 and body["total_marks"] == 10
    assert body["status"] == "published" and body["has_attempts"] is False


def test_questions_locked_but_details_editable_after_start(world):
    eid = create(world)
    start_attempt(world, eid)
    r = world["client"].patch(f"/api/v1/exams/{eid}", headers=world["T"], json={"title": "Exam X", "questions": QUESTIONS})
    assert r.status_code == 400 and "can't be changed" in r.json()["detail"]
    r = world["client"].patch(f"/api/v1/exams/{eid}", headers=world["T"], json={"title": "Renamed", "duration_minutes": 120})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Renamed" and r.json()["duration_minutes"] == 120 and r.json()["question_count"] == 2
    assert r.json()["has_attempts"] is True
    listed = {e["id"]: e for e in world["client"].get(f"/api/v1/exams/course/{world['course_id']}", headers=world["T"]).json()}
    assert listed[eid]["has_attempts"] is True


def test_schedule_and_duration_validation(world):
    r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "Sched",
        "scheduled_start": "2026-11-10T10:00:00Z", "scheduled_end": "2026-11-10T09:00:00Z",
        "duration_minutes": 90, "questions": QUESTIONS})
    # The closing time is never client-controlled: it is always opening time + duration.
    assert r.status_code == 201, r.text
    assert r.json()["scheduled_end"].startswith("2026-11-10T11:30:00")
    for bad in (0, -5, 601):
        r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "Sched", "duration_minutes": bad, "questions": QUESTIONS})
        assert r.status_code == 422


def test_question_marks_validation(world):
    for marks in (-1, 1001, 2.5):
        r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "M", "questions": [
            {"type": "mcq", "text": "x", "options": ["a", "b"], "correct_answer": "a", "marks": marks}]})
        assert r.status_code == 422, marks
    r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "M", "questions": [
        {"type": "mcq", "text": "x", "options": ["a", "b"], "correct_answer": "a", "marks": 0}]})
    assert r.status_code == 422


def test_grading_marks_must_be_between_zero_and_question_total(world):
    eid = create(world)
    aid = start_attempt(world, eid)
    ids = [q["id"] for q in world["client"].get(f"/api/v1/exams/{eid}/questions", headers=world["T"]).json()]
    world["client"].post(f"/api/v1/attempts/{aid}/submit", headers=world["S"])
    grade = lambda m: world["client"].post(f"/api/v1/attempts/{aid}/grade/{ids[0]}", headers=world["T"], json={"marks_awarded": m})
    r = grade(6)
    assert r.status_code == 400 and "cannot be more than" in r.json()["detail"]
    r = grade(-1)
    assert r.status_code == 422 and "negative" in r.text
    r = grade(2.555)
    assert r.status_code == 422 and "2 decimal" in r.text
    r = grade(4.5)
    assert r.status_code == 200 and r.json()["marks_awarded"] == 4.5
    r = grade(5)
    assert r.status_code == 200 and r.json()["marks_awarded"] == 5
    r = grade(0)
    assert r.status_code == 200 and r.json()["marks_awarded"] == 0


def test_schedule_times_are_timezone_safe(world):
    r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "TZ exam",
        "scheduled_start": "2020-01-01T08:00:00", "duration_minutes": 120, "questions": QUESTIONS})
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    assert r.json()["scheduled_end"].startswith("2020-01-01T10:00:00")
    published = world["client"].post(f"/api/v1/exams/{eid}/publish", headers=world["T"])
    assert published.status_code == 200 and published.json()["is_closed"] is True
    r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "TZ exam 2",
        "scheduled_start": "2020-01-01T08:00:00+05:00", "duration_minutes": 120, "questions": QUESTIONS})
    assert r.status_code == 201
    end = r.json()["scheduled_end"]
    assert end.startswith("2020-01-01T05:00:00"), end


def test_security_options_are_always_mandatory(world):
    r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "Sec",
        "security": {"camera": False, "microphone": False, "screenShare": False, "identity": False,
                     "liveness": False, "calculator": False}, "questions": QUESTIONS})
    assert r.status_code == 201, r.text
    sec = r.json()["security"]
    assert all(sec[k] for k in ("camera", "microphone", "screenShare", "identity", "liveness")), sec
    assert sec["calculator"] is False  # the calculator is the one teacher-controlled tool