
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from app.services import mathexpr
from app.services.question_types import MANUAL_TYPES

MAX_RESPONSE_CHARS = 20_000
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Grade:
    marks: float           
    correct: bool | None    
    manual: bool = False


def _result(question, fraction: float) -> Grade:
    fraction = max(0.0, min(1.0, fraction))
    marks = round(float(question.marks) * fraction, 2)
    return Grade(marks=marks, correct=fraction >= 0.999999)


def _json(response: str):
    if not response or len(response) > MAX_RESPONSE_CHARS:
        return None
    try:
        return json.loads(response)
    except (ValueError, RecursionError):
        return None


def _norm(s: str, case_sensitive: bool = False) -> str:
    s = " ".join(str(s).split())
    return s if case_sensitive else s.casefold()


_BOOL = {"t": "T", "true": "T", "1": "T", "f": "F", "false": "F", "0": "F"}


def _cell_equal(expected: str, given: str, tol: float) -> bool:
    given = str(given).strip()
    if not given:
        return False
    try:
        a, b = mathexpr.eval_constant(expected), mathexpr.eval_constant(given)
        return abs(a - b) <= max(tol, 1e-9 * abs(a))
    except (mathexpr.MathParseError, mathexpr.MathEvalError):
        pass
    e, g = _norm(expected), _norm(given)
    if e in _BOOL and g in _BOOL:       
        return _BOOL[e] == _BOOL[g]
    return e == g



def _g_choice(q, r: str) -> float:
    return 1.0 if (q.correct_answer or "").strip().lower() == (r or "").strip().lower() else 0.0


def _g_msq(q, r: str) -> float:
    chosen = _json(r)
    if not isinstance(chosen, list):
        return 0.0
    chosen = {str(x).strip() for x in chosen}
    right = set(q.answer_key["correct"])
    if (q.config or {}).get("scoring", "partial") == "all_or_nothing":
        return 1.0 if chosen == right else 0.0
    return max(0.0, (len(chosen & right) - len(chosen - right)) / len(right))


def _g_fill(q, r: str) -> float:
    given = _json(r)
    blanks = q.answer_key["blanks"]
    if not isinstance(given, list):
        return 0.0
    ok = 0
    for i, b in enumerate(blanks):
        if i < len(given) and isinstance(given[i], str):
            cs = b.get("case_sensitive", False)
            if _norm(given[i], cs) in {_norm(a, cs) for a in b["answers"]}:
                ok += 1
    if (q.config or {}).get("scoring", "partial") == "all_or_nothing":
        return 1.0 if ok == len(blanks) else 0.0
    return ok / len(blanks)


def _g_numeric(q, r: str) -> float:
    try:
        given = mathexpr.eval_constant(r)
    except (mathexpr.MathParseError, mathexpr.MathEvalError):
        return 0.0
    k = q.answer_key
    tol = k["tolerance"] if k["tolerance_type"] == "absolute" else abs(k["value"]) * k["tolerance"] / 100.0
    return 1.0 if abs(given - k["value"]) <= max(tol, 1e-9 * abs(k["value"])) else 0.0


def _g_math(q, r: str) -> float:
    return 1.0 if mathexpr.equivalent(q.answer_key["expression"], r or "") else 0.0


def _g_matrix(q, r: str) -> float:
    given = _json(r)
    expected = q.answer_key["matrix"]
    tol = q.answer_key.get("tolerance", 1e-6)
    if not isinstance(given, list):
        return 0.0
    total = sum(len(row) for row in expected)
    ok = 0
    for i, row in enumerate(expected):
        grow = given[i] if i < len(given) and isinstance(given[i], list) else []
        for j, cell in enumerate(row):
            if j < len(grow) and _cell_equal(cell, grow[j], tol):
                ok += 1
    if (q.config or {}).get("scoring", "partial") == "all_or_nothing":
        return 1.0 if ok == total else 0.0
    return ok / total


def _g_matching(q, r: str) -> float:
    given = _json(r)
    pairs = q.answer_key["pairs"]
    if not isinstance(given, dict):
        return 0.0
    ok = sum(1 for left, right in pairs.items() if given.get(left) == right)
    if (q.config or {}).get("scoring", "partial") == "all_or_nothing":
        return 1.0 if ok == len(pairs) else 0.0
    return ok / len(pairs)


def _g_ordering(q, r: str) -> float:
    given = _json(r)
    order = q.answer_key["order"]
    if not isinstance(given, list):
        return 0.0
    ok = sum(1 for i, item in enumerate(order) if i < len(given) and given[i] == item)
    if (q.config or {}).get("scoring", "partial") == "all_or_nothing":
        return 1.0 if ok == len(order) else 0.0
    return ok / len(order)


def _g_hotspot(q, r: str) -> float:
    pt = _json(r)
    if not isinstance(pt, dict):
        return 0.0
    try:
        x, y = float(pt["x"]), float(pt["y"])
    except (KeyError, TypeError, ValueError):
        return 0.0
    for reg in q.answer_key["regions"]:
        if reg["x"] <= x <= reg["x"] + reg["w"] and reg["y"] <= y <= reg["y"] + reg["h"]:
            return 1.0
    return 0.0


_GRADERS = {
    "mcq": _g_choice, "tf": _g_choice, "msq": _g_msq, "fill_blank": _g_fill,
    "numeric": _g_numeric, "math_expr": _g_math, "matrix": _g_matrix,
    "matching": _g_matching, "ordering": _g_ordering, "hotspot": _g_hotspot,
}


def grade_response(question, response: str | None) -> Grade:
    if question.type in MANUAL_TYPES:
        return Grade(marks=0.0, correct=None, manual=True)
    fn = _GRADERS.get(question.type)
    if fn is None:                                 
        return Grade(marks=0.0, correct=None, manual=True)
    response = (response or "")
    if len(response) > MAX_RESPONSE_CHARS:
        return _result(question, 0.0)
    try:
        return _result(question, fn(question, response))
    except Exception:                               
        logger.warning("grading failed for question %s (type %s)", getattr(question, "id", "?"), question.type, exc_info=True)
        return _result(question, 0.0)
