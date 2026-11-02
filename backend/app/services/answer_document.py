import json
import re
from typing import Any

FORMAT = "unisphere.answer"
SCHEMA_VERSION = 1
COMPONENTS = ("math", "code", "diagram", "table")

MAX_DOC_BYTES = 2_500_000
MAX_NODES = 6000
MAX_DEPTH = 24
MAX_TEXT_NODE = 20_000
MAX_TOTAL_TEXT = 300_000
MAX_LATEX = 5_000
MAX_CODE = 50_000
MAX_DIAGRAMS = 20
MAX_DIAGRAM_ELEMENTS = 3_000
MAX_DIAGRAM_BYTES = 1_500_000
MAX_TABLE_ROWS = 60
MAX_TABLE_COLS = 20
MAX_BLOCK_ID = 64

CODE_LANGUAGES = ("plaintext", "python", "javascript", "java", "c", "cpp")
TEXT_ALIGN = ("left", "center", "right", "justify")
MARKS = {"bold", "italic", "underline", "strike", "code"}
DIAGRAM_ELEMENT_TYPES = {"rectangle", "ellipse", "diamond", "line", "arrow", "freedraw", "text", "frame"}
COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{3,8}|transparent|[a-zA-Z]{3,20})$")
BLOCK_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

INLINE = {"text", "hardBreak", "mathInline"}
BLOCK = {"paragraph", "heading", "bulletList", "orderedList", "blockquote", "horizontalRule",
         "mathBlock", "codeBlock", "diagram", "table"}
CELL_BLOCK = {"paragraph", "bulletList", "orderedList", "mathBlock"}

COMPONENT_OF = {
    "mathInline": "math",
    "mathBlock": "math",
    "codeBlock": "code",
    "diagram": "diagram",
    "table": "table",
}


class AnswerDocumentError(ValueError):
    pass


def _fail(msg: str):
    raise AnswerDocumentError(msg)


def _reject_constant(value):
    _fail("Answer contains an invalid number")


def is_document_string(raw: str | None) -> bool:
    return bool(raw) and raw.lstrip().startswith("{") and f'"{FORMAT}"' in raw[:200]


def empty_document() -> dict:
    return {"format": FORMAT, "schema_version": SCHEMA_VERSION, "doc": {"type": "doc", "content": [{"type": "paragraph"}]}}


def migrate(envelope: dict) -> dict:
    version = envelope.get("schema_version")
    if not isinstance(version, int) or isinstance(version, bool):
        _fail("Answer document has no schema version")
    if version > SCHEMA_VERSION:
        _fail("Answer document was created by a newer version of the editor")
    if version < 1:
        _fail("Unsupported answer document version")
    return envelope


class _Walker:
    def __init__(self, allowed: set[str]):
        self.allowed = allowed
        self.nodes = 0
        self.text_total = 0
        self.diagrams = 0
        self.block_ids: set[str] = set()

    def _attrs(self, node: dict) -> dict:
        attrs = node.get("attrs")
        if attrs is None:
            return {}
        if not isinstance(attrs, dict):
            _fail("Invalid node attributes")
        return attrs

    def _block_id(self, attrs: dict, out: dict) -> None:
        bid = attrs.get("id")
        if bid is None:
            return
        if not isinstance(bid, str) or not BLOCK_ID_RE.match(bid):
            return
        if bid in self.block_ids:
            return
        self.block_ids.add(bid)
        out["id"] = bid

    def _align(self, attrs: dict, out: dict) -> None:
        align = attrs.get("textAlign")
        if align in TEXT_ALIGN and align != "left":
            out["textAlign"] = align

    def _children(self, node: dict, allowed_types: set[str], depth: int, required: bool = False) -> list:
        content = node.get("content")
        if content is None:
            if required:
                _fail(f"{node.get('type')} must have content")
            return []
        if not isinstance(content, list):
            _fail("Invalid node content")
        out = []
        for child in content:
            if not isinstance(child, dict):
                _fail("Invalid node")
            ctype = child.get("type")
            if ctype not in allowed_types:
                _fail(f"'{ctype}' is not allowed inside '{node.get('type')}'")
            out.append(self.node(child, depth + 1))
        if required and not out:
            _fail(f"{node.get('type')} must not be empty")
        return out

    def node(self, node: dict, depth: int) -> dict:
        self.nodes += 1
        if self.nodes > MAX_NODES:
            _fail("Answer is too large (too many elements)")
        if depth > MAX_DEPTH:
            _fail("Answer is nested too deeply")
        ntype = node.get("type")
        comp = COMPONENT_OF.get(ntype)
        if comp and comp not in self.allowed:
            _fail(f"This question does not allow {comp} content")
        attrs = self._attrs(node)
        out: dict[str, Any] = {"type": ntype}
        a: dict[str, Any] = {}

        if ntype == "text":
            text = node.get("text")
            if not isinstance(text, str) or not text:
                _fail("Invalid text")
            if len(text) > MAX_TEXT_NODE:
                _fail("A paragraph is too long")
            self.text_total += len(text)
            if self.text_total > MAX_TOTAL_TEXT:
                _fail("Answer text is too long")
            out["text"] = text
            marks = node.get("marks")
            if marks is not None:
                if not isinstance(marks, list):
                    _fail("Invalid text formatting")
                clean = []
                for m in marks:
                    if not isinstance(m, dict) or m.get("type") not in MARKS:
                        _fail("Unsupported text formatting")
                    if m["type"] not in {x["type"] for x in clean}:
                        clean.append({"type": m["type"]})
                if clean:
                    out["marks"] = clean
            return out

        if ntype == "hardBreak" or ntype == "horizontalRule":
            return out

        if ntype == "paragraph":
            self._block_id(attrs, a)
            self._align(attrs, a)
            children = self._children(node, INLINE, depth)
        elif ntype == "heading":
            level = attrs.get("level")
            if level not in (1, 2, 3):
                _fail("Invalid heading level")
            a["level"] = level
            self._block_id(attrs, a)
            self._align(attrs, a)
            children = self._children(node, INLINE, depth)
        elif ntype in ("bulletList", "orderedList"):
            self._block_id(attrs, a)
            if ntype == "orderedList":
                start = attrs.get("start", 1)
                if not isinstance(start, int) or isinstance(start, bool) or not 0 <= start <= 100000:
                    _fail("Invalid list start")
                if start != 1:
                    a["start"] = start
            children = self._children(node, {"listItem"}, depth, required=True)
        elif ntype == "listItem":
            children = self._children(node, {"paragraph", "bulletList", "orderedList", "mathBlock", "codeBlock"}, depth, required=True)
        elif ntype == "blockquote":
            self._block_id(attrs, a)
            children = self._children(node, BLOCK - {"table", "diagram"}, depth, required=True)
        elif ntype in ("mathInline", "mathBlock"):
            latex = attrs.get("latex", "")
            if not isinstance(latex, str):
                _fail("Invalid equation")
            if len(latex) > MAX_LATEX:
                _fail("An equation is too long")
            a["latex"] = latex
            if ntype == "mathBlock":
                self._block_id(attrs, a)
            children = []
        elif ntype == "codeBlock":
            code = attrs.get("code", "")
            lang = attrs.get("language", "plaintext")
            if not isinstance(code, str):
                _fail("Invalid code block")
            if len(code) > MAX_CODE:
                _fail("A code block is too long")
            if lang not in CODE_LANGUAGES:
                _fail("Unsupported code language")
            a["language"] = lang
            a["code"] = code
            self._block_id(attrs, a)
            children = []
        elif ntype == "diagram":
            self.diagrams += 1
            if self.diagrams > MAX_DIAGRAMS:
                _fail("Too many diagrams in one answer")
            a["scene"] = _clean_scene(attrs.get("scene"))
            self._block_id(attrs, a)
            children = []
        elif ntype == "table":
            self._block_id(attrs, a)
            children = self._children(node, {"tableRow"}, depth, required=True)
            if len(children) > MAX_TABLE_ROWS:
                _fail("Table has too many rows")
            for row in children:
                if len(row.get("content", [])) > MAX_TABLE_COLS:
                    _fail("Table has too many columns")
        elif ntype == "tableRow":
            children = self._children(node, {"tableCell", "tableHeader"}, depth, required=True)
        elif ntype in ("tableCell", "tableHeader"):
            for key in ("colspan", "rowspan"):
                v = attrs.get(key, 1)
                if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= MAX_TABLE_COLS:
                    _fail("Invalid table cell span")
                if v != 1:
                    a[key] = v
            cw = attrs.get("colwidth")
            if cw is not None:
                if not isinstance(cw, list) or len(cw) > MAX_TABLE_COLS or not all(
                    isinstance(x, int) and not isinstance(x, bool) and 0 < x <= 4000 for x in cw
                ):
                    _fail("Invalid table column width")
                a["colwidth"] = cw
            children = self._children(node, CELL_BLOCK, depth, required=True)
        else:
            _fail(f"Unsupported content type '{ntype}'")

        if a:
            out["attrs"] = a
        if children:
            out["content"] = children
        return out


def _clean_scene(scene: Any) -> dict:
    if scene is None:
        return {"elements": [], "appState": {}}
    if not isinstance(scene, dict):
        _fail("Invalid diagram")
    elements = scene.get("elements", [])
    if not isinstance(elements, list):
        _fail("Invalid diagram")
    if len(elements) > MAX_DIAGRAM_ELEMENTS:
        _fail("Diagram has too many shapes")
    clean = []
    for el in elements:
        if not isinstance(el, dict):
            _fail("Invalid diagram shape")
        if el.get("isDeleted"):
            continue
        etype = el.get("type")
        if etype not in DIAGRAM_ELEMENT_TYPES:
            _fail(f"Diagram shape type '{etype}' is not allowed")
        if not isinstance(el.get("id"), str) or len(el["id"]) > 100:
            _fail("Invalid diagram shape id")
        item = {k: v for k, v in el.items() if k not in ("customData", "fileId")}
        link = item.get("link")
        if link is not None and not (isinstance(link, str) and re.match(r"^https?://", link) and len(link) < 2000):
            item["link"] = None
        clean.append(item)
    app_state = scene.get("appState") or {}
    if not isinstance(app_state, dict):
        _fail("Invalid diagram settings")
    out_state = {}
    bg = app_state.get("viewBackgroundColor")
    if isinstance(bg, str) and COLOR_RE.match(bg):
        out_state["viewBackgroundColor"] = bg
    result = {"elements": clean, "appState": out_state}
    if len(json.dumps(result, separators=(",", ":"))) > MAX_DIAGRAM_BYTES:
        _fail("Diagram is too large")
    return result


def parse_envelope(raw: str) -> dict:
    if len(raw.encode("utf-8")) > MAX_DOC_BYTES:
        _fail("Answer is too large")
    try:
        envelope = json.loads(raw, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        _fail("Answer is not a valid document")
    if not isinstance(envelope, dict) or envelope.get("format") != FORMAT:
        _fail("Answer is not a valid document")
    return migrate(envelope)


def validate_document(raw: str, allowed_components) -> str:
    envelope = parse_envelope(raw)
    doc = envelope.get("doc")
    if not isinstance(doc, dict) or doc.get("type") != "doc":
        _fail("Answer document is missing its content")
    walker = _Walker(set(allowed_components or ()))
    normalized_doc = {"type": "doc", "content": walker._children(doc, BLOCK, 0)}
    if not normalized_doc["content"]:
        normalized_doc["content"] = [{"type": "paragraph"}]
    normalized = {"format": FORMAT, "schema_version": SCHEMA_VERSION, "doc": normalized_doc}
    return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))


def plain_text(raw: str) -> str:
    if not is_document_string(raw):
        return raw or ""
    try:
        doc = json.loads(raw).get("doc") or {}
    except ValueError:
        return ""
    parts: list[str] = []

    def walk(n):
        if not isinstance(n, dict):
            return
        t = n.get("type")
        if t == "text":
            parts.append(n.get("text", ""))
        elif t in ("mathInline", "mathBlock"):
            parts.append(f" {(n.get('attrs') or {}).get('latex', '')} ")
        elif t == "codeBlock":
            parts.append("\n" + (n.get("attrs") or {}).get("code", "") + "\n")
        for c in n.get("content") or []:
            walk(c)
        if t in BLOCK or t in ("listItem", "tableRow"):
            parts.append("\n")

    walk(doc)
    return re.sub(r"\n{3,}", "\n\n", "".join(parts)).strip()