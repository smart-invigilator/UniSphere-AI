import re
import random
from typing import Any

QUESTION_TYPES = {
    "mcq",
    "tf",
    "multi",
    "short",
    "essay",
    "fill_blank",
    "dropdown",
    "numeric",
    "math",
    "matrix",
    "matching",
    "ordering",
    "hotspot",
    "file_upload",
    "text_block",
}

MANUAL_TYPES = {"short", "essay", "file_upload"}
RICH_ANSWER_TYPES = {"short", "essay"}
ANSWER_COMPONENTS = ("math", "code", "diagram", "table")
NON_ANSWERABLE_TYPES = {"text_block"}
PLACEHOLDER_RE = re.compile(r"\[\[(\d+)\]\]")
MATH_MODES = {"symbolic", "exact", "manual"}
MATRIX_MODES = {"symbolic", "exact", "manual"}
UPLOAD_ACCEPT = {"image", "pdf", "both"}

MAX_OPTIONS = 20
MAX_ITEM_LEN = 1000
MAX_ACCEPTED = 20
MAX_MATRIX_DIM = 10


def _clean_str(value: Any, field: str, max_len: int = MAX_ITEM_LEN, allow_empty: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, (str, int, float)):
        raise ValueError(f"{field} must be text")
    s = str(value).strip()
    if not s and not allow_empty:
        raise ValueError(f"{field} cannot be empty")
    if len(s) > max_len:
        raise ValueError(f"{field} is too long (max {max_len} characters)")
    return s


def _str_list(values: Any, field: str, min_items: int = 1, max_items: int = MAX_OPTIONS, unique: bool = True) -> list[str]:
    if not isinstance(values, list):
        raise ValueError(f"{field} must be a list")
    cleaned = [_clean_str(v, field) for v in values]
    if len(cleaned) < min_items:
        raise ValueError(f"{field} needs at least {min_items} item(s)")
    if len(cleaned) > max_items:
        raise ValueError(f"{field} can have at most {max_items} items")
    if unique and len({c.lower() for c in cleaned}) != len(cleaned):
        raise ValueError(f"{field} must not contain duplicates")
    return cleaned


def _bool(settings: dict, key: str, default: bool) -> bool:
    v = settings.get(key, default)
    return bool(v) if v is not None else default


def _number(value: Any, field: str) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a number")
    if f != f or f in (float("inf"), float("-inf")):
        raise ValueError(f"{field} must be a finite number")
    return f


def _allowed_components(settings: dict) -> list[str]:
    value = settings.get("allowed_components")
    if value is None:
        return list(ANSWER_COMPONENTS)
    if not isinstance(value, list) or any(v not in ANSWER_COMPONENTS for v in value):
        raise ValueError(f"Allowed answer components must be chosen from {', '.join(ANSWER_COMPONENTS)}")
    return [c for c in ANSWER_COMPONENTS if c in value]


def allowed_components(q) -> list[str]:
    if q.type not in RICH_ANSWER_TYPES:
        return []
    value = (q.settings or {}).get("allowed_components")
    if value is None:
        return list(ANSWER_COMPONENTS)
    return [c for c in ANSWER_COMPONENTS if c in value]


def placeholder_numbers(text: str) -> list[int]:
    return sorted({int(m) for m in PLACEHOLDER_RE.findall(text or "")})


def _require_placeholders(text: str, label: str) -> int:
    nums = placeholder_numbers(text)
    if not nums:
        raise ValueError(f"{label} question text must contain at least one [[1]] placeholder")
    if nums != list(range(1, len(nums) + 1)):
        raise ValueError(f"{label} placeholders must be numbered [[1]], [[2]], ... without gaps")
    if len(nums) > 30:
        raise ValueError(f"{label} question can have at most 30 placeholders")
    return len(nums)


def normalize_question(qtype: str, text: str, options: Any, correct_answer: Any, settings: Any,
                       answer_key: Any, media: list) -> tuple[list | None, str | None, dict, dict | None]:
    settings = dict(settings or {})
    key = dict(answer_key or {}) if isinstance(answer_key, dict) or answer_key is None else None
    if key is None:
        raise ValueError("answer_key must be an object")

    if qtype == "mcq":
        opts = _str_list(options, "Options", min_items=2)
        ca = _clean_str(correct_answer, "Correct answer")
        if ca not in opts:
            raise ValueError("Correct answer must be one of the options")
        return opts, ca, {"shuffle_options": _bool(settings, "shuffle_options", False)}, None

    if qtype == "tf":
        ca = _clean_str(correct_answer, "Correct answer")
        if ca not in ("True", "False"):
            raise ValueError("True/False correct answer must be 'True' or 'False'")
        return ["True", "False"], ca, {}, None

    if qtype == "multi":
        opts = _str_list(options, "Options", min_items=2)
        answers = _str_list(key.get("answers"), "Correct answers", min_items=1)
        missing = [a for a in answers if a not in opts]
        if missing:
            raise ValueError("Every correct answer must be one of the options")
        return opts, None, {
            "shuffle_options": _bool(settings, "shuffle_options", False),
            "partial_credit": _bool(settings, "partial_credit", True),
        }, {"answers": answers}

    if qtype == "short":
        return None, None, {"allowed_components": _allowed_components(settings)}, None

    if qtype == "essay":
        wl = settings.get("word_limit")
        word_limit = None
        if wl not in (None, "", 0, "0"):
            word_limit = int(_number(wl, "Word limit"))
            if word_limit < 1 or word_limit > 20000:
                raise ValueError("Word limit must be between 1 and 20000")
        return None, None, {"word_limit": word_limit, "allowed_components": _allowed_components(settings)}, None

    if qtype == "fill_blank":
        n = _require_placeholders(text, "Fill in the blank")
        blanks = key.get("blanks")
        if not isinstance(blanks, list) or len(blanks) != n:
            raise ValueError(f"Provide accepted answers for each of the {n} blank(s)")
        clean_blanks = [
            _str_list(b if isinstance(b, list) else [b], f"Accepted answers for blank {i + 1}",
                      min_items=1, max_items=MAX_ACCEPTED, unique=False)
            for i, b in enumerate(blanks)
        ]
        return None, None, {
            "case_sensitive": _bool(settings, "case_sensitive", False),
            "partial_credit": _bool(settings, "partial_credit", True),
        }, {"blanks": clean_blanks}

    if qtype == "dropdown":
        n = _require_placeholders(text, "Dropdown")
        dropdowns = settings.get("dropdowns")
        if not isinstance(dropdowns, list) or len(dropdowns) != n:
            raise ValueError(f"Provide options for each of the {n} dropdown(s)")
        clean_dd = [_str_list(d, f"Options for dropdown {i + 1}", min_items=2) for i, d in enumerate(dropdowns)]
        answers = key.get("answers")
        if not isinstance(answers, list) or len(answers) != n:
            raise ValueError("Select the correct option for every dropdown")
        clean_answers = []
        for i, a in enumerate(answers):
            a = _clean_str(a, f"Correct option for dropdown {i + 1}")
            if a not in clean_dd[i]:
                raise ValueError(f"Correct option for dropdown {i + 1} must be one of its options")
            clean_answers.append(a)
        return None, None, {
            "dropdowns": clean_dd,
            "partial_credit": _bool(settings, "partial_credit", True),
        }, {"answers": clean_answers}

    if qtype == "numeric":
        mode = key.get("mode", "exact")
        unit = _clean_str(settings.get("unit", ""), "Unit", max_len=40, allow_empty=True)
        if mode == "range":
            lo = _number(key.get("min"), "Minimum")
            hi = _number(key.get("max"), "Maximum")
            if lo > hi:
                raise ValueError("Minimum must be less than or equal to maximum")
            return None, None, {"unit": unit}, {"mode": "range", "min": lo, "max": hi}
        if mode != "exact":
            raise ValueError("Numeric answer mode must be 'exact' or 'range'")
        value = _number(key.get("value"), "Correct value")
        tol = abs(_number(key.get("tolerance", 0) or 0, "Tolerance"))
        return None, None, {"unit": unit}, {"mode": "exact", "value": value, "tolerance": tol}

    if qtype == "math":
        mode = key.get("mode", "symbolic")
        if mode not in MATH_MODES:
            raise ValueError("Math grading mode must be symbolic, exact or manual")
        raw_answers = key.get("answers") or []
        if not isinstance(raw_answers, list):
            raise ValueError("Math answers must be a list")
        answers = [_clean_str(a, "Math answer", max_len=2000) for a in raw_answers if str(a or "").strip()]
        if mode != "manual" and not answers:
            raise ValueError("Provide at least one correct expression, or choose manual grading")
        return None, None, {}, {"mode": mode, "answers": answers[:MAX_ACCEPTED]}

    if qtype == "matrix":
        try:
            rows = int(settings.get("rows", 2))
            cols = int(settings.get("cols", 2))
        except (TypeError, ValueError):
            raise ValueError("Matrix rows and columns must be whole numbers")
        if not (1 <= rows <= MAX_MATRIX_DIM and 1 <= cols <= MAX_MATRIX_DIM):
            raise ValueError(f"Matrix size must be between 1x1 and {MAX_MATRIX_DIM}x{MAX_MATRIX_DIM}")
        mode = key.get("mode", "symbolic")
        if mode not in MATRIX_MODES:
            raise ValueError("Matrix grading mode must be symbolic, exact or manual")
        cells = key.get("cells")
        clean_cells: list[list[str]] = []
        if mode != "manual" or cells:
            if not isinstance(cells, list) or len(cells) != rows or any(
                not isinstance(r, list) or len(r) != cols for r in cells
            ):
                raise ValueError("Fill every cell of the answer matrix")
            clean_cells = [[_clean_str(c, f"Matrix cell ({ri + 1},{ci + 1})", max_len=200) for ci, c in enumerate(r)]
                           for ri, r in enumerate(cells)]
        return None, None, {
            "rows": rows,
            "cols": cols,
            "partial_credit": _bool(settings, "partial_credit", True),
        }, {"mode": mode, "cells": clean_cells}

    if qtype == "matching":
        pairs = key.get("pairs")
        if not isinstance(pairs, list) or len(pairs) < 2:
            raise ValueError("Matching question needs at least 2 pairs")
        if len(pairs) > MAX_OPTIONS:
            raise ValueError(f"Matching question can have at most {MAX_OPTIONS} pairs")
        clean_pairs = []
        for i, p in enumerate(pairs):
            if not isinstance(p, dict):
                raise ValueError("Each matching pair must have a prompt and an answer")
            clean_pairs.append({
                "prompt": _clean_str(p.get("prompt"), f"Prompt {i + 1}"),
                "answer": _clean_str(p.get("answer"), f"Answer {i + 1}"),
            })
        if len({p["prompt"].lower() for p in clean_pairs}) != len(clean_pairs):
            raise ValueError("Matching prompts must be unique")
        distractors = settings.get("distractors") or []
        clean_d = _str_list(distractors, "Distractors", min_items=0) if distractors else []
        answers_lower = {p["answer"].lower() for p in clean_pairs}
        clean_d = [d for d in clean_d if d.lower() not in answers_lower]
        return None, None, {
            "distractors": clean_d,
            "partial_credit": _bool(settings, "partial_credit", True),
        }, {"pairs": clean_pairs}

    if qtype == "ordering":
        order = _str_list(key.get("order"), "Items", min_items=2)
        return None, None, {"partial_credit": _bool(settings, "partial_credit", True)}, {"order": order}

    if qtype == "hotspot":
        if not media:
            raise ValueError("Hotspot question requires an image")
        regions = key.get("regions")
        if not isinstance(regions, list) or not regions:
            raise ValueError("Draw at least one correct region on the hotspot image")
        clean_regions = []
        for r in regions[:10]:
            if not isinstance(r, dict):
                raise ValueError("Invalid hotspot region")
            x, y, w, h = (_number(r.get(k), "Region") for k in ("x", "y", "w", "h"))
            if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > 1.0001 or y + h > 1.0001:
                raise ValueError("Hotspot region must lie inside the image")
            clean_regions.append({"x": round(x, 5), "y": round(y, 5), "w": round(w, 5), "h": round(h, 5)})
        return None, None, {}, {"regions": clean_regions}

    if qtype == "file_upload":
        accept = settings.get("accept", "both")
        if accept not in UPLOAD_ACCEPT:
            raise ValueError("Accepted file type must be image, pdf or both")
        try:
            max_files = int(settings.get("max_files", 1))
        except (TypeError, ValueError):
            raise ValueError("Max files must be a whole number")
        if not 1 <= max_files <= 5:
            raise ValueError("Max files must be between 1 and 5")
        return None, None, {"accept": accept, "max_files": max_files}, None

    if qtype == "text_block":
        return None, None, {}, None

    raise ValueError(f"Unsupported question type: {qtype}")


def _shuffled(items: list, seed: str) -> list:
    out = list(items)
    random.Random(seed).shuffle(out)
    return out


def public_view(q, seed: str) -> tuple[list | None, dict]:
    t = q.type
    s = q.settings or {}
    k = q.answer_key or {}
    options = q.options

    if t in ("mcq", "multi"):
        if s.get("shuffle_options") and options:
            options = _shuffled(options, f"{seed}:opts")
        pub = {}
        if t == "multi":
            pub["partial_credit"] = bool(s.get("partial_credit", True))
        return options, pub
    if t == "tf":
        return options or ["True", "False"], {}
    if t == "essay":
        return None, {"word_limit": s.get("word_limit"), "allowed_components": allowed_components(q)}
    if t == "short":
        return None, {"allowed_components": allowed_components(q)}
    if t == "fill_blank":
        return None, {"blank_count": len(k.get("blanks") or []) or len(placeholder_numbers(q.text))}
    if t == "dropdown":
        return None, {"dropdowns": s.get("dropdowns") or []}
    if t == "numeric":
        return None, {"unit": s.get("unit", "")}
    if t == "matrix":
        return None, {"rows": int(s.get("rows", 2)), "cols": int(s.get("cols", 2))}
    if t == "matching":
        pairs = k.get("pairs") or []
        choices = []
        seen = set()
        for c in [p["answer"] for p in pairs] + list(s.get("distractors") or []):
            if c.lower() not in seen:
                seen.add(c.lower())
                choices.append(c)
        return None, {"prompts": [p["prompt"] for p in pairs], "choices": _shuffled(choices, f"{seed}:match")}
    if t == "ordering":
        items = list(k.get("order") or [])
        shuffled = _shuffled(items, f"{seed}:order")
        if len(items) > 1 and shuffled == items:
            shuffled = shuffled[1:] + shuffled[:1]
        return None, {"items": shuffled}
    if t == "file_upload":
        return None, {"accept": s.get("accept", "both"), "max_files": int(s.get("max_files", 1))}
    return None, {}