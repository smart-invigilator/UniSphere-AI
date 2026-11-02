import cmath
import json
import logging
import math
import random
import re
import threading
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

from app.services.question_types import MANUAL_TYPES, NON_ANSWERABLE_TYPES

logger = logging.getLogger(__name__)

MAX_LATEX_LEN = 400
MAX_SYMBOLS = 6
SAMPLE_COUNT = 8

ALLOWED_LATEX_COMMANDS = {
    "frac", "dfrac", "tfrac", "sqrt", "cdot", "times", "div", "left", "right", "sin", "cos", "tan",
    "sec", "csc", "cot", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "ln", "log", "exp",
    "pi", "binom", "alpha", "beta", "gamma", "delta", "theta", "lambda", "mu", "sigma", "phi", "omega",
    "tau", "rho", "epsilon", "varepsilon", "varphi", "psi", "chi", "eta", "zeta", "kappa", "nu", "xi",
}


@dataclass
class GradeResult:
    is_correct: bool | None
    fraction: float
    requires_manual: bool


def _manual() -> GradeResult:
    return GradeResult(None, 0.0, True)


def _result(fraction: float) -> GradeResult:
    fraction = max(0.0, min(1.0, fraction))
    return GradeResult(fraction >= 0.999999, fraction, False)


def load_json(raw: str | None, default: Any) -> Any:
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def norm_text(value: Any, case_sensitive: bool = False) -> str:
    s = re.sub(r"\s+", " ", str(value if value is not None else "").strip())
    return s if case_sensitive else s.lower()


def to_number(value: Any) -> float | None:
    s = str(value if value is not None else "").strip().replace(" ", "").replace("\u2212", "-")
    if not s or len(s) > 64:
        return None
    try:
        f = float(Fraction(s))
    except (ValueError, ZeroDivisionError, OverflowError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def text_equal(a: Any, b: Any, case_sensitive: bool = False) -> bool:
    if norm_text(a, case_sensitive) == norm_text(b, case_sensitive):
        return True
    x, y = to_number(a), to_number(b)
    if x is not None and y is not None:
        return math.isclose(x, y, rel_tol=1e-9, abs_tol=1e-9)
    return False


_LATEX_SPACING = re.compile(r"\\[,;:! ]|\\quad|\\qquad")
_LATEX_ALIASES = [
    (r"\dfrac", r"\frac"), (r"\tfrac", r"\frac"), (r"\le ", r"\leq "), (r"\ge ", r"\geq "),
    (r"\ne ", r"\neq "), (r"\rightarrow", r"\to"), (r"\wedge", r"\land"), (r"\vee", r"\lor"),
    (r"\lnot", r"\neg"), (r"\leftrightarrow", r"\iff"), (r"\Leftrightarrow", r"\iff"),
    (r"\Rightarrow", r"\implies"), (r"\times", r"\cdot"), (r"\left", ""), (r"\right", ""),
    (r"\mathbb", ""), (r"\mathrm", ""), (r"\operatorname", ""),
]


def latex_norm(latex: Any) -> str:
    s = str(latex or "")
    s = _LATEX_SPACING.sub(" ", s)
    for a, b in _LATEX_ALIASES:
        s = s.replace(a, b)
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"([\^_])\{([A-Za-z0-9])\}", r"\1\2", s)
    s = s.rstrip(".")
    return s


_parser_lock = threading.Lock()
_parser_state = {"ready": None}


def _parser():
    if _parser_state["ready"] is None:
        with _parser_lock:
            if _parser_state["ready"] is None:
                try:
                    from sympy.parsing.latex import parse_latex
                    parse_latex("x+1")
                    _parser_state["ready"] = parse_latex
                except Exception as exc:
                    logger.warning("LaTeX parser unavailable, math questions fall back to manual grading: %s", exc)
                    _parser_state["ready"] = False
    return _parser_state["ready"] or None


class _Unsupported(Exception):
    pass


def to_sympy(latex: str):
    if not latex or len(latex) > MAX_LATEX_LEN:
        return None
    for cmd in re.findall(r"\\([A-Za-z]+)", latex):
        if cmd not in ALLOWED_LATEX_COMMANDS:
            return None
    if re.search(r"\d{16,}", latex):
        return None
    parse = _parser()
    if parse is None:
        return None
    try:
        from sympy import evaluate
        with evaluate(False):
            return parse(latex)
    except Exception:
        return None


_FUNCS = {
    "sin": cmath.sin, "cos": cmath.cos, "tan": cmath.tan, "asin": cmath.asin, "acos": cmath.acos,
    "atan": cmath.atan, "sinh": cmath.sinh, "cosh": cmath.cosh, "tanh": cmath.tanh, "exp": cmath.exp,
    "sec": lambda x: 1 / cmath.cos(x), "csc": lambda x: 1 / cmath.sin(x), "cot": lambda x: 1 / cmath.tan(x),
}


def _gamma_real(z: complex) -> complex:
    if abs(z.imag) > 1e-12 or z.real > 170:
        raise _Unsupported()
    return complex(math.gamma(z.real))


def num_eval(node, values: dict, depth: int = 0) -> complex:
    if depth > 200:
        raise _Unsupported()
    from sympy import Symbol
    from sympy.core.numbers import ImaginaryUnit
    if isinstance(node, ImaginaryUnit):
        return 1j
    if node.is_Number or getattr(node, "is_NumberSymbol", False):
        return complex(float(node))
    if isinstance(node, Symbol):
        if node.name in values:
            return values[node.name]
        if node.name == "e":
            return complex(math.e)
        raise _Unsupported()
    args = [num_eval(a, values, depth + 1) for a in node.args]
    name = type(node).__name__
    if node.is_Add:
        return sum(args, 0j)
    if node.is_Mul:
        out = 1 + 0j
        for a in args:
            out *= a
        return out
    if node.is_Pow:
        base, exp = args
        if abs(exp.real) > 1e4:
            raise _Unsupported()
        if base.imag == 0 and exp.imag == 0 and (base.real >= 0 or float(exp.real).is_integer()):
            return complex(math.pow(base.real, exp.real))
        return base ** exp
    if name in _FUNCS:
        return _FUNCS[name](args[0])
    if name == "log":
        if len(args) == 2:
            return cmath.log(args[0]) / cmath.log(args[1])
        return cmath.log(args[0])
    if name == "Abs":
        return complex(abs(args[0]))
    if name == "factorial":
        return _gamma_real(args[0] + 1)
    if name == "binomial":
        n, k = args
        return _gamma_real(n + 1) / (_gamma_real(k + 1) * _gamma_real(n - k + 1))
    raise _Unsupported()


def _close(a: complex, b: complex) -> bool:
    scale = max(1.0, abs(a), abs(b))
    return abs(a - b) <= 1e-7 * scale


def _free_names(expr) -> set[str]:
    return {s.name for s in expr.free_symbols if s.name != "e"}


def _as_function(expr):
    from sympy import Add, Mul, Integer
    from sympy.core.relational import Equality, Relational
    if isinstance(expr, Equality):
        return "eq", Add(expr.lhs, Mul(Integer(-1), expr.rhs, evaluate=False), evaluate=False)
    if isinstance(expr, Relational):
        return "rel", None
    return "expr", expr


def math_equivalent(expected: str, given: str) -> bool | None:
    ea, eb = to_sympy(expected), to_sympy(given)
    if ea is None or eb is None:
        return None
    try:
        ka, fa = _as_function(ea)
        kb, fb = _as_function(eb)
    except Exception:
        return None
    if ka == "rel" or kb == "rel" or ka != kb:
        return None
    names = sorted(_free_names(fa) | _free_names(fb))
    if len(names) > MAX_SYMBOLS:
        return None
    rng = random.Random(918273)
    trials = 1 if not names else SAMPLE_COUNT
    matches = mismatches = neg_matches = 0
    for _ in range(trials):
        vals = {n: complex(rng.uniform(0.35, 2.65)) for n in names}
        try:
            va = num_eval(fa, vals)
            vb = num_eval(fb, vals)
        except (_Unsupported, ValueError, ZeroDivisionError, OverflowError, TypeError):
            continue
        if any(map(lambda v: math.isnan(v.real) or math.isinf(v.real) or math.isnan(v.imag) or math.isinf(v.imag), (va, vb))):
            continue
        if _close(va, vb):
            matches += 1
        else:
            mismatches += 1
        if ka == "eq" and _close(va, -vb):
            neg_matches += 1
    needed = 1 if not names else 3
    if mismatches == 0 and matches >= needed:
        return True
    if ka == "eq" and neg_matches >= needed and neg_matches == matches + mismatches:
        return True
    if mismatches > 0 and mismatches >= matches:
        return False
    return None


def _cell_verdict(expected: str, given: str, mode: str) -> bool | None:
    if not str(given or "").strip():
        return False
    if mode == "exact":
        return latex_norm(expected) == latex_norm(given) or text_equal(expected, given, True)
    if text_equal(expected, given) or latex_norm(expected) == latex_norm(given):
        return True
    return math_equivalent(expected, given)


def grade(q, raw_response: str | None) -> GradeResult:
    t = q.type
    s = q.settings or {}
    k = q.answer_key or {}
    partial = bool(s.get("partial_credit", True))
    raw = raw_response or ""

    if t in NON_ANSWERABLE_TYPES:
        return GradeResult(None, 0.0, False)
    if t in MANUAL_TYPES:
        return _manual()

    if t in ("mcq", "tf"):
        return _result(1.0 if norm_text(q.correct_answer) == norm_text(raw) and raw.strip() else 0.0)

    if t == "multi":
        selected = load_json(raw, [])
        if not isinstance(selected, list):
            return _result(0.0)
        sel = {str(x) for x in selected}
        correct = set(k.get("answers") or [])
        if not correct:
            return _manual()
        if not partial:
            return _result(1.0 if sel == correct else 0.0)
        right = len(sel & correct)
        wrong = len(sel - correct)
        return _result((right - wrong) / len(correct))

    if t == "fill_blank":
        given = load_json(raw, [])
        blanks = k.get("blanks") or []
        if not blanks:
            return _manual()
        if not isinstance(given, list):
            given = []
        cs = bool(s.get("case_sensitive", False))
        hits = 0
        for i, accepted in enumerate(blanks):
            g = given[i] if i < len(given) else ""
            if str(g).strip() and any(text_equal(a, g, cs) for a in accepted):
                hits += 1
        frac = hits / len(blanks)
        return _result(frac if partial else (1.0 if hits == len(blanks) else 0.0))

    if t == "dropdown":
        given = load_json(raw, [])
        answers = k.get("answers") or []
        if not answers:
            return _manual()
        if not isinstance(given, list):
            given = []
        hits = sum(1 for i, a in enumerate(answers) if i < len(given) and norm_text(given[i]) == norm_text(a))
        frac = hits / len(answers)
        return _result(frac if partial else (1.0 if hits == len(answers) else 0.0))

    if t == "numeric":
        v = to_number(raw)
        if v is None:
            return _result(0.0)
        if k.get("mode") == "range":
            return _result(1.0 if float(k["min"]) - 1e-12 <= v <= float(k["max"]) + 1e-12 else 0.0)
        target = float(k.get("value", 0))
        tol = abs(float(k.get("tolerance", 0) or 0))
        ok = abs(v - target) <= tol + 1e-9 * max(1.0, abs(target))
        return _result(1.0 if ok else 0.0)

    if t == "math":
        mode = k.get("mode", "symbolic")
        answers = k.get("answers") or []
        if mode == "manual" or not answers:
            return _manual()
        if not raw.strip():
            return _result(0.0)
        if any(latex_norm(a) == latex_norm(raw) for a in answers):
            return _result(1.0)
        if mode == "exact":
            return _result(0.0)
        verdicts = []
        for a in answers:
            try:
                verdicts.append(math_equivalent(a, raw))
            except Exception:
                verdicts.append(None)
        if any(v is True for v in verdicts):
            return _result(1.0)
        if verdicts and all(v is False for v in verdicts):
            return _result(0.0)
        return _manual()

    if t == "matrix":
        mode = k.get("mode", "symbolic")
        cells = k.get("cells") or []
        if mode == "manual" or not cells:
            return _manual()
        given = load_json(raw, [])
        if not isinstance(given, list):
            given = []
        total = sum(len(r) for r in cells)
        hits = 0
        undecided = False
        for ri, row in enumerate(cells):
            grow = given[ri] if ri < len(given) and isinstance(given[ri], list) else []
            for ci, expected in enumerate(row):
                g = grow[ci] if ci < len(grow) else ""
                try:
                    verdict = _cell_verdict(expected, g, mode)
                except Exception:
                    verdict = None
                if verdict is True:
                    hits += 1
                elif verdict is None:
                    undecided = True
        if undecided:
            return _manual()
        frac = hits / total if total else 0.0
        return _result(frac if partial else (1.0 if hits == total else 0.0))

    if t == "matching":
        pairs = k.get("pairs") or []
        if not pairs:
            return _manual()
        given = load_json(raw, {})
        if not isinstance(given, dict):
            given = {}
        hits = sum(1 for p in pairs if norm_text(given.get(p["prompt"], "")) == norm_text(p["answer"]))
        frac = hits / len(pairs)
        return _result(frac if partial else (1.0 if hits == len(pairs) else 0.0))

    if t == "ordering":
        order = k.get("order") or []
        if not order:
            return _manual()
        given = load_json(raw, [])
        if not isinstance(given, list) or not given:
            return _result(0.0)
        hits = sum(1 for i, item in enumerate(order) if i < len(given) and given[i] == item)
        frac = hits / len(order)
        return _result(frac if partial else (1.0 if hits == len(order) else 0.0))

    if t == "hotspot":
        regions = k.get("regions") or []
        if not regions:
            return _manual()
        point = load_json(raw, {})
        if not isinstance(point, dict):
            return _result(0.0)
        try:
            x, y = float(point.get("x")), float(point.get("y"))
        except (TypeError, ValueError):
            return _result(0.0)
        inside = any(r["x"] <= x <= r["x"] + r["w"] and r["y"] <= y <= r["y"] + r["h"] for r in regions)
        return _result(1.0 if inside else 0.0)

    return _manual()