
from __future__ import annotations

import math
import random
import re

MAX_LEN = 300
MAX_TOKENS = 250
MAX_DEPTH = 40
MAX_ABS_EXPONENT = 400  


class MathParseError(ValueError):
    """The text is not a valid expression."""


class MathEvalError(ArithmeticError):
    """The expression is valid but cannot be evaluated at these values
    (division by zero, sqrt of a negative, overflow, ...)."""

_FUNCS_1 = {
    "sqrt": math.sqrt, "cbrt": lambda v: math.copysign(abs(v) ** (1 / 3), v),
    "abs": abs, "exp": math.exp, "ln": math.log, "log": math.log10,
    "log10": math.log10, "log2": math.log2,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "sec": lambda v: 1 / math.cos(v), "csc": lambda v: 1 / math.sin(v),
    "cot": lambda v: 1 / math.tan(v),
    "asin": math.asin, "acos": math.acos, "atan": math.atan,
    "sinh": math.sinh, "cosh": math.cosh, "tanh": math.tanh,
}
_CONSTS = {"pi": math.pi, "e": math.e}

_UNICODE = {
    "×": "*", "·": "*", "⋅": "*", "÷": "/", "−": "-", "–": "-", "π": "pi",
    "²": "^2", "³": "^3", "⁴": "^4", "[": "(", "]": ")", "{": "(", "}": ")",
    "∗": "*",
}

_NUM = re.compile(r"\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?")
_LOGN = re.compile(r"log10|log2", re.I)
_WORD = re.compile(r"[A-Za-z]+")
_NAMES = sorted(_FUNCS_1.keys() | _CONSTS.keys(), key=len, reverse=True)


def _normalize(text: str) -> str:
    text = text.strip()
    text = re.sub(r"√\s*\(", "sqrt(", text)
    text = re.sub(r"√\s*([A-Za-z0-9.]+)", r"sqrt(\1)", text)
    for k, v in _UNICODE.items():
        text = text.replace(k, v)
    text = text.replace("**", "^")
    return text


def _split_word(word: str) -> list[tuple[str, object]]:
    """Split a run of letters into functions, constants and one-letter
    variables:  'xsin' -> x, sin ;  'pix' -> pi, x ;  'xy' -> x, y."""
    out: list[tuple[str, object]] = []
    i = 0
    while i < len(word):
        for name in _NAMES:
            if word[i:i + len(name)].lower() == name:
                out.append(("func", name) if name in _FUNCS_1 else ("num", _CONSTS[name]))
                i += len(name)
                break
        else:
            out.append(("var", word[i]))
            i += 1
    return out


def _tokenize(text: str) -> list[tuple[str, object]]:
    text = _normalize(text)
    if not text:
        raise MathParseError("empty expression")
    if len(text) > MAX_LEN:
        raise MathParseError("expression too long")
    toks: list[tuple[str, object]] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        m = _NUM.match(text, i)
        if m:
            toks.append(("num", float(m.group())))
            i = m.end()
            continue
        m = _LOGN.match(text, i)
        if m:
            toks.append(("func", m.group().lower()))
            i = m.end()
            continue
        m = _WORD.match(text, i)
        if m:
            toks.extend(_split_word(m.group()))
            i = m.end()
            continue
        if ch in "+-*/^()":
            toks.append(("op", ch))
            i += 1
            continue
        raise MathParseError(f"unexpected character '{ch}'")
    if len(toks) > MAX_TOKENS:
        raise MathParseError("expression too long")
    return toks
class _Parser:
    def __init__(self, toks):
        self.t = toks
        self.i = 0
        self.depth = 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def eat(self):
        tok = self.peek()
        self.i += 1
        return tok

    def parse(self):
        node = self.expr()
        if self.i != len(self.t):
            raise MathParseError("unexpected trailing input")
        return node

    def _enter(self):
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise MathParseError("expression nested too deeply")

    def _leave(self):
        self.depth -= 1

    def expr(self):
        self._enter()
        node = self.term()
        while self.peek() in (("op", "+"), ("op", "-")):
            op = self.eat()[1]
            rhs = self.term()
            node = ("add" if op == "+" else "sub", node, rhs)
        self._leave()
        return node

    def _starts_primary(self):
        kind, val = self.peek()
        return kind in ("num", "var", "func") or (kind == "op" and val == "(")

    def term(self):
        node = self.unary()
        while True:
            kind, val = self.peek()
            if kind == "op" and val in ("*", "/"):
                self.eat()
                rhs = self.unary()
                node = ("mul" if val == "*" else "div", node, rhs)
            elif self._starts_primary():          
                rhs = self.unary()
                node = ("mul", node, rhs)
            else:
                return node

    def unary(self):
        kind, val = self.peek()
        if kind == "op" and val in ("+", "-"):
            self.eat()
            self._enter()
            inner = self.unary()
            self._leave()
            return ("neg", inner) if val == "-" else inner
        return self.power()

    def power(self):
        base = self.primary()
        if self.peek() == ("op", "^"):
            self.eat()
            self._enter()
            exp = self.unary()        
            self._leave()
            return ("pow", base, exp)
        return base

    def primary(self):
        kind, val = self.eat()
        if kind == "num":
            return ("num", val)
        if kind == "var":
            return ("var", val)
        if kind == "func":
            if self.peek() != ("op", "("):
                raise MathParseError(f"{val} needs parentheses, e.g. {val}(x)")
            self.eat()
            inner = self.expr()
            if self.eat() != ("op", ")"):
                raise MathParseError("missing )")
            return ("func", val, inner)
        if (kind, val) == ("op", "("):
            inner = self.expr()
            if self.eat() != ("op", ")"):
                raise MathParseError("missing )")
            return inner
        raise MathParseError("incomplete expression")


def parse(text: str):
    return _Parser(_tokenize(text)).parse()


def variables(node) -> set[str]:
    kind = node[0]
    if kind == "var":
        return {node[1]}
    if kind == "num":
        return set()
    out: set[str] = set()
    for child in node[1:]:
        if isinstance(child, tuple):
            out |= variables(child)
    return out



def evaluate(node, env: dict[str, float] | None = None) -> float:
    env = env or {}
    kind = node[0]
    try:
        if kind == "num":
            return node[1]
        if kind == "var":
            if node[1] not in env:
                raise MathEvalError(f"unbound variable {node[1]}")
            return env[node[1]]
        if kind == "neg":
            return -evaluate(node[1], env)
        if kind == "func":
            return _check(_FUNCS_1[node[1]](evaluate(node[2], env)))
        a = evaluate(node[1], env)
        b = evaluate(node[2], env)
        if kind == "add":
            return _check(a + b)
        if kind == "sub":
            return _check(a - b)
        if kind == "mul":
            return _check(a * b)
        if kind == "div":
            return _check(a / b)
        if kind == "pow":
            if abs(b) > MAX_ABS_EXPONENT:
                raise MathEvalError("exponent too large")
            if a < 0 and b != int(b):
                raise MathEvalError("fractional power of a negative number")
            return _check(a ** b)
    except (ZeroDivisionError, OverflowError, ValueError) as e:
        raise MathEvalError(str(e)) from e
    raise MathEvalError("bad node")  


def _check(v):
    if isinstance(v, complex) or v != v or v in (math.inf, -math.inf):
        raise MathEvalError("not a finite real number")
    return float(v)


def eval_constant(text: str) -> float:
    """Evaluate an expression that has no variables, e.g. '1/3' or '2*pi'."""
    node = parse(text)
    if variables(node):
        raise MathParseError("a plain number is expected here")
    return evaluate(node)



def equivalent(expected: str, given: str, *, samples: int = 28,
               rtol: float = 1e-6, atol: float = 1e-9) -> bool:
    """True when two expressions agree numerically at many random points."""
    try:
        e_node, g_node = parse(expected), parse(given)
    except MathParseError:
        return False
    e_vars, g_vars = variables(e_node), variables(g_node)
    if not g_vars <= e_vars:
        return False
    names = sorted(e_vars)
    rng = random.Random(20240601)
    compared = 0
    for k in range(samples):
        env = {}
        for n in names:
            v = rng.uniform(0.15, 4.0) if k % 2 == 0 else rng.uniform(-4.0, 4.0)
            env[n] = v if abs(v) > 0.05 else 0.37
        try:
            ev = evaluate(e_node, env)
        except MathEvalError:
            continue
        try:
            gv = evaluate(g_node, env)
        except MathEvalError:
            return False
        if abs(ev - gv) > atol + rtol * max(abs(ev), abs(gv)):
            return False
        compared += 1
    return compared >= 6 or (not names and compared >= 1)
