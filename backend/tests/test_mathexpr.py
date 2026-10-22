import pytest
from app.services import mathexpr as m


@pytest.mark.parametrize("a,b", [
    ("x^2-1", "(x-1)(x+1)"),
    ("x^2 - 1", "(x - 1)*(x + 1)"),
    ("2x", "x+x"),
    ("2x^2+3x", "x(2x+3)"),
    ("sin(x)^2+cos(x)^2", "1"),
    ("sqrt(x)", "x^(1/2)"),
    ("ln(x^2)", "2ln(abs(x))"),
    ("e^x", "exp(x)"),
    ("1/(2x)", "0.5/x"),
    ("-x^2", "-(x^2)"),
    ("x**2", "x^2"),
    ("x²", "x^2"),
    ("√x", "sqrt(x)"),
    ("2π", "2*pi"),
    ("xy", "x*y"),
    ("2xy", "y*2*x"),
    ("(x+y)^2", "x^2+2xy+y^2"),
    ("x2", "2x"),
    ("xsin(x)", "x*sin(x)"),
    ("log(x)", "ln(x)/ln(10)"),
])
def test_equivalent_true(a, b):
    assert m.equivalent(a, b)


@pytest.mark.parametrize("a,b", [
    ("x^2", "x^3"),
    ("x^2-1", "(x-1)^2"),
    ("2x", "x"),
    ("sin(x)", "cos(x)"),
    ("x+1", "y+1"),          # student used a variable the key does not have
    ("x^2", "x^2+0.001"),
    ("sqrt(x)", "x"),
    ("x", "(("),             # garbage
    ("x", ""),
    ("ln(x^2)", "2ln(x)"),   # different domain: undefined for x<0, so NOT equivalent
])
def test_equivalent_false(a, b):
    assert not m.equivalent(a, b)


def test_eval_constant():
    assert m.eval_constant("1/3") == pytest.approx(1 / 3)
    assert m.eval_constant("2*pi") == pytest.approx(6.283185307)
    assert m.eval_constant("sqrt(2)") == pytest.approx(1.41421356)
    assert m.eval_constant("-3.5e2") == pytest.approx(-350)
    assert m.eval_constant("3,5".replace(",", ".")) == 3.5


@pytest.mark.parametrize("bad", [
    "", "   ", "x", "1/0", "sqrt(-1)", "2+", "(1", "1)", "sin 1", "__import__('os')",
    "open('f')", "1;2", "a.b", "9^9^9^9", "(" * 200 + "1" + ")" * 200, "1" * 400,
])
def test_eval_constant_rejects(bad):
    with pytest.raises((m.MathParseError, m.MathEvalError)):
        m.eval_constant(bad)


def test_hostile_input_is_fast():
    import time
    t = time.time()
    for bad in ["9^9^9^9^9", "(" * 500, "x^" * 200 + "x", "1+" * 300 + "1"]:
        assert not m.equivalent("x", bad)
    assert time.time() - t < 1.0


def test_no_code_execution_possible():
    # none of these may raise anything except our own errors, and none may "succeed"
    for evil in ["__import__('os').system('echo hi')", "().__class__", "lambda: 1", "exec('1')"]:
        assert not m.equivalent("x", evil)
