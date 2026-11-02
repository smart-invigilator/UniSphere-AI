import json
import pytest
from app.services.answer_document import (
    FORMAT, SCHEMA_VERSION, AnswerDocumentError, validate_document, plain_text, is_document_string,
)

ALL = ["math", "code", "diagram", "table"]


def env(content, version=SCHEMA_VERSION):
    return json.dumps({"format": FORMAT, "schema_version": version, "doc": {"type": "doc", "content": content}})


def para(text, marks=None, **attrs):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = [{"type": m} for m in marks]
    out = {"type": "paragraph", "content": [node]}
    if attrs:
        out["attrs"] = attrs
    return out


FULL = [
    para("Intro with ", ["bold"], id="b1"),
    {"type": "paragraph", "content": [{"type": "text", "text": "inline "}, {"type": "mathInline", "attrs": {"latex": "\\frac{a}{b}"}}]},
    {"type": "mathBlock", "attrs": {"latex": "\\int_0^1 x^2\\,dx = \\tfrac{1}{3}", "id": "m1"}},
    {"type": "codeBlock", "attrs": {"language": "python", "code": "def f(x):\n\tif x:\n        return \"q\\\\\"\n", "id": "c1"}},
    {"type": "diagram", "attrs": {"id": "d1", "scene": {"elements": [
        {"id": "r1", "type": "rectangle", "x": 1, "y": 2, "width": 10, "height": 10, "link": "javascript:alert(1)"},
        {"id": "t1", "type": "text", "text": "label ∀x", "x": 0, "y": 0},
        {"id": "gone", "type": "ellipse", "isDeleted": True},
    ], "appState": {"viewBackgroundColor": "#ffffff", "evil": "<script>"}}}},
    {"type": "table", "attrs": {"id": "t1"}, "content": [
        {"type": "tableRow", "content": [
            {"type": "tableHeader", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None}, "content": [para("H")]},
            {"type": "tableCell", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None}, "content": [{"type": "paragraph", "content": [{"type": "mathInline", "attrs": {"latex": "x^2"}}]}]},
        ]},
    ]},
    {"type": "bulletList", "content": [{"type": "listItem", "content": [para("item ünïcödé — “quotes”")]}]},
]


def test_full_document_roundtrip_preserves_order_and_content():
    out = json.loads(validate_document(env(FULL), ALL))
    types = [n["type"] for n in out["doc"]["content"]]
    assert types == ["paragraph", "paragraph", "mathBlock", "codeBlock", "diagram", "table", "bulletList"]
    assert out["doc"]["content"][2]["attrs"]["latex"] == "\\int_0^1 x^2\\,dx = \\tfrac{1}{3}"
    assert out["doc"]["content"][3]["attrs"]["code"] == "def f(x):\n\tif x:\n        return \"q\\\\\"\n"
    assert out["doc"]["content"][6]["content"][0]["content"][0]["content"][0]["text"] == "item ünïcödé — “quotes”"


def test_normalization_is_idempotent():
    once = validate_document(env(FULL), ALL)
    assert validate_document(once, ALL) == once


def test_diagram_sanitized():
    out = json.loads(validate_document(env(FULL), ALL))
    scene = out["doc"]["content"][4]["attrs"]["scene"]
    assert [e["id"] for e in scene["elements"]] == ["r1", "t1"]
    assert scene["elements"][0]["link"] is None
    assert scene["appState"] == {"viewBackgroundColor": "#ffffff"}


@pytest.mark.parametrize("component,node", [
    ("math", {"type": "mathBlock", "attrs": {"latex": "x"}}),
    ("code", {"type": "codeBlock", "attrs": {"language": "c", "code": "int x;"}}),
    ("diagram", {"type": "diagram", "attrs": {"scene": {"elements": []}}}),
    ("table", {"type": "table", "content": [{"type": "tableRow", "content": [{"type": "tableCell", "content": [{"type": "paragraph"}]}]}]}),
])
def test_disallowed_components_rejected(component, node):
    allowed = [c for c in ALL if c != component]
    with pytest.raises(AnswerDocumentError):
        validate_document(env([node]), allowed)
    validate_document(env([node]), ALL)


def test_inline_math_in_paragraph_requires_math_permission():
    node = {"type": "paragraph", "content": [{"type": "mathInline", "attrs": {"latex": "x"}}]}
    with pytest.raises(AnswerDocumentError):
        validate_document(env([node]), ["code"])


@pytest.mark.parametrize("bad", [
    "not json",
    json.dumps({"format": "other", "schema_version": 1, "doc": {"type": "doc"}}),
    json.dumps({"format": FORMAT, "schema_version": 99, "doc": {"type": "doc", "content": []}}),
    json.dumps({"format": FORMAT, "doc": {"type": "doc", "content": []}}),
    env([{"type": "script", "content": []}]),
    env([{"type": "paragraph", "content": [{"type": "text", "text": "x", "marks": [{"type": "link", "attrs": {"href": "javascript:x"}}]}]}]),
    env([{"type": "codeBlock", "attrs": {"language": "bash", "code": "rm -rf /"}}]),
    env([{"type": "heading", "attrs": {"level": 9}, "content": []}]),
    env([{"type": "diagram", "attrs": {"scene": {"elements": [{"id": "i", "type": "image", "fileId": "x"}]}}}]),
    env([{"type": "diagram", "attrs": {"scene": {"elements": [{"id": "i", "type": "embeddable", "link": "https://evil"}]}}}]),
    env([{"type": "mathBlock", "attrs": {"latex": "x" * 6000}}]),
    env([{"type": "paragraph", "content": [{"type": "paragraph"}]}]),
    '{"format":"unisphere.answer","schema_version":1,"doc":{"type":"doc","content":[{"type":"mathBlock","attrs":{"latex":NaN}}]}}',
])
def test_malformed_or_malicious_rejected(bad):
    with pytest.raises(AnswerDocumentError):
        validate_document(bad, ALL)


def test_deep_nesting_rejected():
    node = para("x")
    for _ in range(40):
        node = {"type": "blockquote", "content": [node]}
    with pytest.raises(AnswerDocumentError):
        validate_document(env([node]), ALL)


def test_unknown_attrs_and_duplicate_ids_dropped():
    out = json.loads(validate_document(env([para("a", id="dup", onclick="x"), para("b", id="dup")]), ALL))
    assert out["doc"]["content"][0]["attrs"] == {"id": "dup"}
    assert "attrs" not in out["doc"]["content"][1]


def test_plain_text_and_detection():
    raw = validate_document(env(FULL), ALL)
    assert is_document_string(raw)
    assert not is_document_string("hello")
    txt = plain_text(raw)
    assert "Intro with" in txt and "\\frac{a}{b}" in txt and "def f(x):" in txt