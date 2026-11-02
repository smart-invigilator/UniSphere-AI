import json
from tests.conftest import start_attempt
from app.services.answer_document import FORMAT

ALL = ["math", "code", "diagram", "table"]


def doc(content):
    return json.dumps({"format": FORMAT, "schema_version": 1, "doc": {"type": "doc", "content": content}})


MIXED = [
    {"type": "paragraph", "attrs": {"id": "p1"}, "content": [{"type": "text", "text": "Step 1: by definition"}]},
    {"type": "mathBlock", "attrs": {"id": "m1", "latex": "\\forall x \\in \\mathbb{R}, \\exists y : y > x"}},
    {"type": "paragraph", "attrs": {"id": "p2"}, "content": [{"type": "text", "text": "Then the diagram:"}]},
    {"type": "diagram", "attrs": {"id": "d1", "scene": {"elements": [
        {"id": "a", "type": "rectangle", "x": 0, "y": 0, "width": 80, "height": 40},
        {"id": "b", "type": "arrow", "x": 80, "y": 20, "points": [[0, 0], [60, 0]],
         "startBinding": {"elementId": "a"}, "endBinding": None},
        {"id": "c", "type": "text", "x": 5, "y": 5, "text": "Node A"},
    ], "appState": {"viewBackgroundColor": "#ffffff"}}}},
    {"type": "table", "attrs": {"id": "t1"}, "content": [
        {"type": "tableRow", "content": [
            {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "n"}]}]},
            {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "T(n)"}]}]},
        ]},
        {"type": "tableRow", "content": [
            {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "8"}]}]},
            {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "mathInline", "attrs": {"latex": "n\\log n"}}]}]},
        ]},
    ]},
    {"type": "codeBlock", "attrs": {"id": "c1", "language": "cpp", "code": "int main() {\n    return 0;\n}\n"}},
]


def make_exam(w, short_allowed=("math",), essay_allowed=ALL):
    qs = [
        {"type": "short", "text": "Define $f$", "marks": 5, "settings": {"allowed_components": list(short_allowed)}},
        {"type": "essay", "text": "Prove it", "marks": 10, "settings": {"allowed_components": list(essay_allowed)}},
        {"type": "mcq", "text": "Pick", "options": ["a", "b"], "correct_answer": "a", "marks": 2},
        {"type": "essay", "text": "Legacy", "marks": 3},
    ]
    r = w["client"].post("/api/v1/exams", headers=w["T"], json={"course_id": w["course_id"], "title": "E1", "questions": qs})
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    assert w["client"].post(f"/api/v1/exams/{eid}/publish", headers=w["T"]).status_code == 200
    tq = w["client"].get(f"/api/v1/exams/{eid}/questions", headers=w["T"]).json()
    return eid, [q["id"] for q in tq], tq


def save(w, aid, qid, response, seq=None):
    body = {"question_id": qid, "response": response}
    if seq is not None:
        body["client_seq"] = seq
    return w["client"].post(f"/api/v1/attempts/{aid}/answer", headers=w["S"], json=body)


def test_question_config_persisted_and_public(world):
    eid, ids, tq = make_exam(world)
    assert tq[0]["settings"]["allowed_components"] == ["math"]
    assert tq[1]["settings"]["allowed_components"] == ALL
    assert tq[3]["settings"]["allowed_components"] == ALL
    aid = start_attempt(world, eid)
    sq = world["client"].get(f"/api/v1/exams/{eid}/questions", headers=world["S"]).json()
    assert sq[0]["settings"]["allowed_components"] == ["math"]
    assert "allowed_components" not in sq[2]["settings"]


def test_bad_component_config_rejected(world):
    r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "E", "questions": [
        {"type": "short", "text": "x", "marks": 1, "settings": {"allowed_components": ["video"]}}]})
    assert r.status_code == 422


def test_mixed_answer_full_lifecycle(world):
    eid, ids, _ = make_exam(world)
    aid = start_attempt(world, eid)
    r = save(world, aid, ids[1], doc(MIXED), seq=1000)
    assert r.status_code == 200, r.text
    assert r.json()["stale"] is False and r.json()["revision"] == 1
    restored = {a["question_id"]: a for a in world["client"].get(f"/api/v1/attempts/{aid}/answers", headers=world["S"]).json()}
    content = json.loads(restored[ids[1]]["response"])["doc"]["content"]
    assert [n["type"] for n in content] == ["paragraph", "mathBlock", "paragraph", "diagram", "table", "codeBlock"]
    assert content[1]["attrs"]["latex"] == "\\forall x \\in \\mathbb{R}, \\exists y : y > x"
    assert content[5]["attrs"]["code"] == "int main() {\n    return 0;\n}\n"
    scene = content[3]["attrs"]["scene"]
    assert [e["id"] for e in scene["elements"]] == ["a", "b", "c"]
    assert scene["elements"][1]["startBinding"] == {"elementId": "a"}
    assert restored[ids[1]]["client_seq"] == 1000

    assert save(world, aid, ids[2], "a").status_code == 200
    sub = world["client"].post(f"/api/v1/attempts/{aid}/submit", headers=world["S"]).json()
    assert sub["status"] == "submitted" and sub["ungraded_questions"] == 3 and sub["auto_score"] == 2

    assert save(world, aid, ids[1], doc(MIXED[:1]), seq=2000).status_code == 400

    teacher_view = {a["question_id"]: a for a in world["client"].get(f"/api/v1/attempts/{aid}/answers", headers=world["T"]).json()}
    assert json.loads(teacher_view[ids[1]]["response"])["doc"]["content"] == content
    assert teacher_view[ids[1]]["requires_manual"] is True

    for qid, marks in ((ids[0], 0), (ids[1], 9), (ids[3], 1)):
        r = world["client"].post(f"/api/v1/attempts/{aid}/grade/{qid}", headers=world["T"], json={"marks_awarded": marks})
        assert r.status_code == 200
    after = {a["question_id"]: a for a in world["client"].get(f"/api/v1/attempts/{aid}/answers", headers=world["T"]).json()}
    assert after[ids[1]]["response"] == teacher_view[ids[1]]["response"]
    final = world["client"].get(f"/api/v1/attempts/{aid}", headers=world["T"]).json()
    assert final["status"] == "graded" and final["final_score"] == 12


def test_stale_and_duplicate_saves_do_not_overwrite(world):
    eid, ids, _ = make_exam(world)
    aid = start_attempt(world, eid)
    new = doc([{"type": "paragraph", "content": [{"type": "text", "text": "newest"}]}])
    old = doc([{"type": "paragraph", "content": [{"type": "text", "text": "older"}]}])
    assert save(world, aid, ids[1], new, seq=500).json()["stale"] is False
    r = save(world, aid, ids[1], old, seq=400)
    assert r.status_code == 200 and r.json()["stale"] is True and "newest" in r.json()["response"]
    r = save(world, aid, ids[1], old, seq=500)
    assert r.json()["stale"] is True and "newest" in r.json()["response"]
    r = save(world, aid, ids[1], old, seq=501)
    assert r.json()["stale"] is False and r.json()["revision"] == 2


def test_permissions_enforced_server_side(world):
    eid, ids, _ = make_exam(world, short_allowed=("math",))
    aid = start_attempt(world, eid)
    code = doc([{"type": "codeBlock", "attrs": {"language": "python", "code": "x=1"}}])
    r = save(world, aid, ids[0], code, seq=1)
    assert r.status_code == 400 and "code" in r.json()["detail"]
    ok = doc([{"type": "paragraph", "content": [{"type": "mathInline", "attrs": {"latex": "x^2"}}]}])
    assert save(world, aid, ids[0], ok, seq=2).status_code == 200


def test_type_restrictions(world):
    eid, ids, _ = make_exam(world)
    aid = start_attempt(world, eid)
    assert save(world, aid, ids[1], "plain text answer").status_code == 400
    assert save(world, aid, ids[2], doc(MIXED)).status_code == 400
    assert save(world, aid, ids[2], "b").status_code == 200
    assert save(world, aid, ids[1], "").status_code == 200


def test_malicious_payloads(world):
    eid, ids, _ = make_exam(world)
    aid = start_attempt(world, eid)
    for bad in [
        '{"format":"unisphere.answer","schema_version":1,"doc":{"type":"doc","content":[{"type":"iframe"}]}}',
        '{"format":"unisphere.answer","schema_version":1,"doc":"<img src=x onerror=alert(1)>"}',
        '{"format":"unisphere.answer","schema_version":1,' + '"doc":' + '[' * 5000 + ']' * 5000 + '}',
    ]:
        assert save(world, aid, ids[1], bad).status_code == 400
    huge = doc([{"type": "paragraph", "content": [{"type": "text", "text": "x" * 20000}]}] * 200)
    assert save(world, aid, ids[1], huge).status_code in (400, 422)


def test_teacher_cannot_write_answers(world):
    eid, ids, _ = make_exam(world)
    aid = start_attempt(world, eid)
    r = world["client"].post(f"/api/v1/attempts/{aid}/answer", headers=world["T"], json={"question_id": ids[1], "response": doc(MIXED)})
    assert r.status_code == 403


def test_objective_types_unaffected(world):
    qs = [
        {"type": "mcq", "text": "m", "options": ["a", "b"], "correct_answer": "a", "marks": 1},
        {"type": "tf", "text": "t", "options": ["True", "False"], "correct_answer": "True", "marks": 1},
        {"type": "multi", "text": "mu", "options": ["a", "b", "c"], "answer_key": {"answers": ["a", "b"]}, "marks": 2},
        {"type": "fill_blank", "text": "x [[1]]", "answer_key": {"blanks": [["y"]]}, "marks": 1},
        {"type": "matching", "text": "match", "answer_key": {"pairs": [{"prompt": "p", "answer": "A"}, {"prompt": "q", "answer": "B"}]}, "marks": 2},
        {"type": "ordering", "text": "o", "answer_key": {"order": ["1", "2"]}, "marks": 1},
        {"type": "math", "text": "simplify", "answer_key": {"mode": "symbolic", "answers": ["x+1"]}, "marks": 2},
    ]
    r = world["client"].post("/api/v1/exams", headers=world["T"], json={"course_id": world["course_id"], "title": "Obj", "questions": qs})
    eid = r.json()["id"]
    world["client"].post(f"/api/v1/exams/{eid}/publish", headers=world["T"])
    ids = [q["id"] for q in world["client"].get(f"/api/v1/exams/{eid}/questions", headers=world["T"]).json()]
    aid = start_attempt(world, eid)
    answers = ["a", "True", json.dumps(["a", "b"]), json.dumps(["y"]), json.dumps({"p": "A", "q": "B"}), json.dumps(["1", "2"]), "\\frac{x^2-1}{x-1}"]
    for qid, resp in zip(ids, answers):
        assert save(world, aid, qid, resp).status_code == 200
    sub = world["client"].post(f"/api/v1/attempts/{aid}/submit", headers=world["S"]).json()
    assert sub["auto_score"] == 10 and sub["status"] == "graded"