"""Pure unit tests: validation (what a teacher saves) + grading (what a student earns)."""
import json
from types import SimpleNamespace as NS

import pytest

from app.services.grading import grade_response
from app.services.question_types import QuestionError, build_question_fields, public_config


def qin(type, text="Q?", marks=10, **kw):
    return NS(type=type, text=text, marks=marks, options=kw.get("options"),
              correct_answer=kw.get("correct_answer"), config=kw.get("config"),
              answer_key=kw.get("answer_key"), image_url=kw.get("image_url"))


def stored(type, marks=10, **kw):
    """Validate like the API does, then wrap as the DB row grading will see."""
    f = build_question_fields(qin(type, marks=marks, **kw))
    return NS(id=1, **f)


def marks(q, resp):
    return grade_response(q, resp).marks


# ------------------------------------------------------------------ legacy
def test_mcq_and_tf_unchanged():
    q = stored("mcq", options=["A", "B", "C"], correct_answer="B")
    assert marks(q, "B") == 10 and marks(q, " b ") == 10 and marks(q, "A") == 0 and marks(q, "") == 0
    t = stored("tf", correct_answer="True")
    assert marks(t, "True") == 10 and marks(t, "False") == 0


def test_short_and_essay_are_manual():
    for t in ("short", "essay"):
        g = grade_response(stored(t), "anything")
        assert g.manual and g.correct is None


# --------------------------------------------------------------------- msq
def test_msq_partial_and_all_or_nothing():
    q = stored("msq", options=["a", "b", "c", "d"], answer_key={"correct": ["a", "b"]})
    assert marks(q, json.dumps(["a", "b"])) == 10
    assert marks(q, json.dumps(["a"])) == 5
    assert marks(q, json.dumps(["a", "c"])) == 0          # one right, one wrong -> 0
    assert marks(q, json.dumps(["a", "b", "c", "d"])) == 0
    assert marks(q, "not json") == 0
    q2 = stored("msq", options=["a", "b", "c"], answer_key={"correct": ["a", "b"]}, config={"scoring": "all_or_nothing"})
    assert marks(q2, json.dumps(["a"])) == 0 and marks(q2, json.dumps(["b", "a"])) == 10


# -------------------------------------------------------------- fill blank
def test_fill_blank():
    q = stored("fill_blank", text="The [[1]] of a graph has [[2]] edges", marks=10,
               answer_key={"blanks": [{"answers": ["Handshake lemma", "handshaking lemma"]},
                                      {"answers": ["Even"], "case_sensitive": True}]})
    assert marks(q, json.dumps(["handshake  LEMMA", "Even"])) == 10
    assert marks(q, json.dumps(["handshake lemma", "even"])) == 5      # 2nd blank is case sensitive
    assert marks(q, json.dumps(["x", "y"])) == 0
    assert marks(q, json.dumps(["handshake lemma"])) == 5              # missing blank tolerated


def test_fill_blank_validation():
    with pytest.raises(QuestionError):
        build_question_fields(qin("fill_blank", text="no blanks", answer_key={"blanks": []}))
    with pytest.raises(QuestionError):                                  # gap: [[1]] [[3]]
        build_question_fields(qin("fill_blank", text="[[1]] [[3]]", answer_key={"blanks": [{"answers": ["a"]}] * 2}))


# ----------------------------------------------------------------- numeric
def test_numeric_tolerances():
    q = stored("numeric", answer_key={"value": "9.81", "tolerance": 0.05})
    assert marks(q, "9.8") == 10 and marks(q, "9.81") == 10 and marks(q, "9.7") == 0 and marks(q, "abc") == 0
    p = stored("numeric", answer_key={"value": 200, "tolerance": 5, "tolerance_type": "percent"})
    assert marks(p, "209") == 10 and marks(p, "211") == 0
    f = stored("numeric", answer_key={"value": "1/3", "tolerance": 0.001})
    assert marks(f, "0.3333") == 10 and marks(f, "1/3") == 10
    s = stored("numeric", answer_key={"value": "sqrt(2)", "tolerance": 1e-6})
    assert marks(s, "1.41421356") == 10 and marks(s, "1.4") == 0


# ---------------------------------------------------------------- math expr
def test_math_expr():
    q = stored("math_expr", answer_key={"expression": "x^2 - 1"})
    assert q.config["variables"] == ["x"]
    assert marks(q, "(x-1)(x+1)") == 10 and marks(q, "x^2-1") == 10 and marks(q, "x²−1") == 10
    assert marks(q, "x^2+1") == 0 and marks(q, "") == 0 and marks(q, "__import__('os')") == 0
    with pytest.raises(QuestionError):
        build_question_fields(qin("math_expr", answer_key={"expression": "((("}))


# ------------------------------------------------------------------- matrix
def test_matrix_and_truth_table():
    q = stored("matrix", marks=8, answer_key={"matrix": [["1", "0"], ["1/2", "3"]]}, config={"rows": 2, "cols": 2})
    assert marks(q, json.dumps([["1", "0"], ["0.5", "3"]])) == 8
    assert marks(q, json.dumps([["1", "0"], ["0.5", "4"]])) == 6        # 3 of 4 cells
    assert marks(q, json.dumps([["1"]])) == 2                           # short answer: only 1 cell right
    assert marks(q, "garbage") == 0
    tt = stored("matrix", marks=4, answer_key={"matrix": [["T", "F"], ["F", "F"]]},
                config={"col_labels": ["p", "q"]})
    assert marks(tt, json.dumps([["true", "0"], ["f", "False"]])) == 4  # T/F/1/0/true/false interchangeable
    assert tt.config["rows"] == 2 and tt.config["cols"] == 2


# ----------------------------------------------------------------- matching
def test_matching_shuffle_hides_answer():
    cfg = {"left": [{"id": "l1", "text": "A"}, {"id": "l2", "text": "B"}, {"id": "l3", "text": "C"}],
           "right": [{"id": "r1", "text": "x"}, {"id": "r2", "text": "y"}, {"id": "r3", "text": "z"}, {"id": "r4", "text": "extra"}]}
    q = stored("matching", marks=9, config=cfg, answer_key={"pairs": {"l1": "r1", "l2": "r2", "l3": "r3"}})
    assert marks(q, json.dumps({"l1": "r1", "l2": "r2", "l3": "r3"})) == 9
    assert marks(q, json.dumps({"l1": "r1", "l2": "r3", "l3": "r2"})) == 3
    pub = public_config(q, "student-7")
    assert "pairs" not in pub and "answer_key" not in pub
    assert pub == public_config(q, "student-7")                          # stable for one student
    with pytest.raises(QuestionError):                                   # a left item left unmatched
        build_question_fields(qin("matching", config=cfg, answer_key={"pairs": {"l1": "r1"}}))


# ----------------------------------------------------------------- ordering
def test_ordering():
    items = [{"id": f"i{n}", "text": f"step {n}"} for n in range(1, 5)]
    q = stored("ordering", marks=8, config={"items": items})
    assert q.answer_key["order"] == ["i1", "i2", "i3", "i4"]
    assert marks(q, json.dumps(["i1", "i2", "i3", "i4"])) == 8
    assert marks(q, json.dumps(["i1", "i2", "i4", "i3"])) == 4
    shown = [i["id"] for i in public_config(q, "s1")["items"]]
    assert sorted(shown) == ["i1", "i2", "i3", "i4"] and shown != ["i1", "i2", "i3", "i4"]
    assert "order" not in public_config(q, "s1")
    assert [i["id"] for i in q.config["items"]] == ["i1", "i2", "i3", "i4"]   # deepcopy: stored data not mutated


# ------------------------------------------------------------------ hotspot
def test_hotspot():
    url = "/media/questions/2026/10/" + "a" * 32 + ".jpg"
    q = stored("hotspot", image_url=url, answer_key={"regions": [{"x": 10, "y": 20, "w": 30, "h": 10}]})
    assert marks(q, json.dumps({"x": 25, "y": 25})) == 10
    assert marks(q, json.dumps({"x": 50, "y": 25})) == 0
    assert marks(q, json.dumps({"x": "bad"})) == 0
    with pytest.raises(QuestionError):
        build_question_fields(qin("hotspot", answer_key={"regions": [{"x": 0, "y": 0, "w": 5, "h": 5}]}))  # no image


# -------------------------------------------------------------------- images
def test_image_url_must_be_ours():
    for bad in ["http://evil.example/x.png", "/media/questions/../../etc/passwd", "javascript:alert(1)",
                "/media/questions/2026/10/short.jpg"]:
        with pytest.raises(QuestionError):
            build_question_fields(qin("short", image_url=bad))
    ok = "/media/questions/2026/10/" + "0" * 32 + ".png"
    assert build_question_fields(qin("short", image_url=ok))["image_url"] == ok


def test_unknown_type_and_garbage_never_crash():
    with pytest.raises(QuestionError):
        build_question_fields(qin("code"))
    q = stored("matrix", answer_key={"matrix": [["1"]]})
    for junk in [None, "", "[[", "null", "{}", "[1,2,3]", "x" * 50000, json.dumps([[{"a": 1}]])]:
        assert grade_response(q, junk).marks == 0
