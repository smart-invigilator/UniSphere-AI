
from __future__ import annotations

import copy
import random
import re
from typing import Any

from app.core.config import settings
from app.services import mathexpr

AUTO_TYPES = {
    "mcq", "msq", "tf", "fill_blank", "numeric", "math_expr",
    "matrix", "matching", "ordering", "hotspot",
}
MANUAL_TYPES = {"short", "essay"}
ALL_TYPES = AUTO_TYPES | MANUAL_TYPES

MAX_OPTIONS = 10
MAX_BLANKS = 10
MAX_MATRIX = 10
MAX_PAIRS = 10
MAX_ITEMS = 10
MAX_REGIONS = 5

_BLANK_RE = re.compile(r"\[\[(\d+)\]\]")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


class QuestionError(ValueError):
    """Raised with a teacher-readable message when a question is invalid."""

def _clean_str(v: Any, field: str, *, max_len: int = 500) -> str:
    if not isinstance(v, str):
        v = "" if v is None else str(v)
    v = v.strip()
    if not v:
        raise QuestionError(f"{field} cannot be empty")
    if len(v) > max_len:
        raise QuestionError(f"{field} is too long (max {max_len} characters)")
    return v


def _scoring(config: dict) -> str:
    s = (config or {}).get("scoring", "partial")
    if s not in ("partial", "all_or_nothing"):
        raise QuestionError("scoring must be 'partial' or 'all_or_nothing'")
    return s


def _items(raw: Any, field: str, lo: int, hi: int) -> list[dict]:
    """Normalise a list of {"id","text"} items; make ids when missing."""
    if not isinstance(raw, list) or not (lo <= len(raw) <= hi):
        raise QuestionError(f"{field} needs between {lo} and {hi} items")
    out, seen = [], set()
    for i, it in enumerate(raw):
        text = it.get("text") if isinstance(it, dict) else it
        iid = (it.get("id") if isinstance(it, dict) else None) or f"i{i + 1}"
        iid = str(iid)
        if not _ID_RE.match(iid) or iid in seen:
            raise QuestionError(f"{field}: duplicate or invalid item id '{iid}'")
        seen.add(iid)
        out.append({"id": iid, "text": _clean_str(text, f"{field} item {i + 1}", max_len=300)})
    return out


def validate_image_url(url: str | None) -> str | None:
    if not url:
        return None
    prefix = settings.MEDIA_URL.rstrip("/") + "/questions/"
    if not re.fullmatch(re.escape(prefix) + r"\d{4}/\d{2}/[0-9a-f]{32}\.(png|jpg)", url):
        raise QuestionError("image must be uploaded through the image uploader")
    return url



def build_question_fields(q) -> dict:
    """Validate a QuestionIn and return the column values to store."""
    t = q.type
    if t not in ALL_TYPES:
        raise QuestionError(f"unknown question type '{t}'")
    text = _clean_str(q.text, "Question text", max_len=5000)
    config = dict(q.config or {})
    key = dict(q.answer_key or {})
    options: list[str] | None = None
    correct: str | None = None
    out_key: dict | None = None
    out_cfg: dict = {}

    alt = (config.get("image_alt") or "").strip()
    if alt:
        out_cfg["image_alt"] = alt[:300]

    if t in ("mcq", "tf"):
        if t == "tf":
            options = ["True", "False"]
        else:
            options = _option_list(q.options)
        correct = (q.correct_answer or "").strip()
        if correct not in options:
            raise QuestionError("choose which option is correct")

    elif t == "msq":
        options = _option_list(q.options)
        right = key.get("correct")
        if not isinstance(right, list) or not right:
            raise QuestionError("select at least one correct option")
        right = [str(x).strip() for x in right]
        if any(x not in options for x in right) or len(set(right)) != len(right):
            raise QuestionError("correct options must be chosen from the option list")
        out_key = {"correct": right}
        out_cfg["scoring"] = _scoring(config)

    elif t == "short":
        pass

    elif t == "essay":
        mw = config.get("max_words")
        if mw not in (None, ""):
            try:
                mw = int(mw)
            except (TypeError, ValueError):
                raise QuestionError("max words must be a number")
            if not 1 <= mw <= 20000:
                raise QuestionError("max words must be between 1 and 20000")
            out_cfg["max_words"] = mw

    elif t == "fill_blank":
        numbers = [int(n) for n in _BLANK_RE.findall(text)]
        k = len(numbers)
        if k == 0:
            raise QuestionError("put blanks in the text as [[1]], [[2]], ...")
        if k > MAX_BLANKS or sorted(numbers) != list(range(1, k + 1)):
            raise QuestionError("blanks must be numbered [[1]], [[2]], ... without gaps or repeats")
        blanks = key.get("blanks")
        if not isinstance(blanks, list) or len(blanks) != k:
            raise QuestionError(f"provide the accepted answer(s) for all {k} blank(s)")
        cleaned = []
        for i, b in enumerate(blanks):
            answers = b.get("answers") if isinstance(b, dict) else None
            if not isinstance(answers, list):
                raise QuestionError(f"blank {i + 1}: provide at least one accepted answer")
            answers = [a.strip() for a in (str(x) for x in answers) if a.strip()]
            if not answers or len(answers) > 20:
                raise QuestionError(f"blank {i + 1}: provide 1-20 accepted answers")
            cleaned.append({"answers": answers, "case_sensitive": bool(b.get("case_sensitive", False))})
        out_key = {"blanks": cleaned}
        out_cfg.update(blank_count=k, scoring=_scoring(config))

    elif t == "numeric":
        raw = key.get("value")
        try:
            value = mathexpr.eval_constant(str(raw))
        except (mathexpr.MathParseError, mathexpr.MathEvalError):
            raise QuestionError("the correct value must be a number (e.g. 3.14 or 1/3)")
        try:
            tol = float(key.get("tolerance", 0) or 0)
        except (TypeError, ValueError):
            raise QuestionError("tolerance must be a number")
        ttype = key.get("tolerance_type", "absolute")
        if tol < 0 or ttype not in ("absolute", "percent"):
            raise QuestionError("tolerance must be >= 0, type 'absolute' or 'percent'")
        out_key = {"value": value, "tolerance": tol, "tolerance_type": ttype}
        unit = (config.get("unit") or "").strip()
        if unit:
            out_cfg["unit"] = unit[:20]

    elif t == "math_expr":
        expr = key.get("expression")
        if not isinstance(expr, str) or not expr.strip():
            raise QuestionError("enter the correct expression")
        try:
            node = mathexpr.parse(expr)
        except mathexpr.MathParseError as e:
            raise QuestionError(f"correct expression is not valid: {e}")
        out_key = {"expression": expr.strip()}
        out_cfg["variables"] = sorted(mathexpr.variables(node))

    elif t == "matrix":
        mat = key.get("matrix")
        if not isinstance(mat, list) or not mat or not all(isinstance(r, list) and r for r in mat):
            raise QuestionError("enter the correct matrix / table values")
        rows, cols = len(mat), len(mat[0])
        if rows > MAX_MATRIX or cols > MAX_MATRIX or any(len(r) != cols for r in mat):
            raise QuestionError(f"matrix must be rectangular, at most {MAX_MATRIX}x{MAX_MATRIX}")
        cells = [[_clean_str(c, "matrix cell", max_len=60) for c in r] for r in mat]
        try:
            tol = float(key.get("tolerance", 1e-6) or 0)
        except (TypeError, ValueError):
            raise QuestionError("tolerance must be a number")
        out_key = {"matrix": cells, "tolerance": max(tol, 0.0)}
        out_cfg.update(rows=rows, cols=cols, scoring=_scoring(config))
        for lab in ("row_labels", "col_labels"):
            labels = config.get(lab)
            want = rows if lab == "row_labels" else cols
            if labels:
                if not isinstance(labels, list) or len(labels) != want:
                    raise QuestionError(f"{lab.replace('_', ' ')} must have {want} entries")
                out_cfg[lab] = [str(x).strip()[:60] for x in labels]

    elif t == "matching":
        left = _items(config.get("left"), "left column", 2, MAX_PAIRS)
        right = _items(config.get("right"), "right column", 2, MAX_PAIRS + 5)
        pairs = key.get("pairs")
        right_ids = {r["id"] for r in right}
        if not isinstance(pairs, dict) or set(pairs) != {l["id"] for l in left} \
                or any(v not in right_ids for v in pairs.values()):
            raise QuestionError("match every left item to an item in the right column")
        out_cfg.update(left=left, right=right, scoring=_scoring(config))
        out_key = {"pairs": {str(k): str(v) for k, v in pairs.items()}}

    elif t == "ordering":
        items = _items(config.get("items"), "items", 2, MAX_ITEMS)
        out_cfg.update(items=items, scoring=_scoring(config))
        out_key = {"order": [i["id"] for i in items]}

    elif t == "hotspot":
        if not q.image_url:
            raise QuestionError("a hotspot question needs an image")
        regions = key.get("regions")
        if not isinstance(regions, list) or not (1 <= len(regions) <= MAX_REGIONS):
            raise QuestionError(f"mark 1-{MAX_REGIONS} correct area(s) on the image")
        clean = []
        for r in regions:
            try:
                x, y, w, h = (float(r[k]) for k in ("x", "y", "w", "h"))
            except (KeyError, TypeError, ValueError):
                raise QuestionError("invalid hotspot area")
            if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > 100.01 or y + h > 100.01:
                raise QuestionError("hotspot area must lie inside the image")
            clean.append({"x": round(x, 3), "y": round(y, 3), "w": round(w, 3), "h": round(h, 3)})
        out_key = {"regions": clean}

    return {
        "type": t, "text": text, "options": options, "correct_answer": correct,
        "config": out_cfg or None, "answer_key": out_key,
        "image_url": validate_image_url(q.image_url), "marks": int(q.marks),
    }


def _option_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        raise QuestionError("add the answer options")
    opts = [str(o).strip() for o in raw]
    if len(opts) < 2 or len(opts) > MAX_OPTIONS:
        raise QuestionError(f"needs between 2 and {MAX_OPTIONS} options")
    if any(not o for o in opts):
        raise QuestionError("an option is empty")
    if len({o.lower() for o in opts}) != len(opts):
        raise QuestionError("two options are identical")
    if any(len(o) > 500 for o in opts):
        raise QuestionError("an option is too long")
    return opts



_SECRET_KEYS = {"answer_key", "answers", "pairs", "order", "correct", "blanks", "regions", "value", "expression"}


def public_config(question, seed: str) -> dict | None:
    """Config that is safe to send to a student. Shuffles the right-hand
    column of matching and the items of ordering."""
    cfg = copy.deepcopy(question.config) if question.config else None
    if not cfg:
        return cfg
    for k in list(cfg):
        if k in _SECRET_KEYS:
            del cfg[k]
    rng = random.Random(f"{seed}:{question.id}")
    if question.type == "matching" and cfg.get("right"):
        rng.shuffle(cfg["right"])
    if question.type == "ordering" and cfg.get("items"):
        original = [i["id"] for i in cfg["items"]]
        items = cfg["items"]
        for _ in range(8):
            rng.shuffle(items)
            if [i["id"] for i in items] != original:
                break
        else:                                 
            items.append(items.pop(0))
    return cfg
