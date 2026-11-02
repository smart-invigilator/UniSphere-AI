import json
import os
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

INFO = json.load(open(os.environ.get("E2E_INFO", "/tmp/ae_e2e_info.json")))
API = "http://localhost:8001/api/v1"
APP = "http://localhost:5174/e2e/harness.html"
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/shots")
os.makedirs(SHOTS, exist_ok=True)
Q_ESSAY, Q_SHORT, Q_MCQ = INFO["questions"]
RESULTS = []


def step(name):
    def deco(fn):
        def run(*a, **k):
            t = time.time()
            fn(*a, **k)
            RESULTS.append((name, round(time.time() - t, 1)))
            print(f"  PASS  {name}", flush=True)
        return run
    return deco


def api(path, token, method="GET", body=None):
    req = urllib.request.Request(f"{API}{path}", method=method, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def server_doc(qid):
    _, rows = api(f"/attempts/{INFO['attempt']}/answers", INFO["student_token"])
    row = next((r for r in rows if r["question_id"] == qid), None)
    return (json.loads(row["response"])["doc"] if row and row["response"] else None), row


def blocks(doc):
    return [n for n in doc["content"] if not (n["type"] == "paragraph" and not n.get("content"))]


def wait_saved(page, timeout=20000):
    page.wait_for_function("() => { const s = document.querySelector('[data-testid=\"save-status\"]'); return s && s.dataset.status === 'saved' }", timeout=timeout)


def wait_server_contains(qid, needle, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        doc, _ = server_doc(qid)
        if doc and needle in json.dumps(doc, ensure_ascii=False):
            return doc
        time.sleep(0.4)
    raise AssertionError(f"server never received {needle!r}")


def wait_layout_stable(page, selector, settle_ms=400, timeout=15000):
    page.wait_for_function(
        """([sel, settle]) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const h = Math.round(el.getBoundingClientRect().height);
            const now = performance.now();
            if (window.__lastH !== h) { window.__lastH = h; window.__stableSince = now; return false; }
            return now - window.__stableSince >= settle;
        }""",
        arg=[selector, settle_ms], timeout=timeout, polling=100,
    )


def editor(page):
    return page.locator('[data-testid="unified-editor"] .ae-prose').first


def open_student(page):
    page.goto(f"{APP}#mode=student&exam={INFO['exam']}&attempt={INFO['attempt']}&token={INFO['student_token']}")
    page.wait_for_selector('[data-testid="unified-editor"] .ae-prose', timeout=60000)


def math_dialog_save(page, latex=None, typed=None):
    page.wait_for_selector("math-field", timeout=20000)
    if typed is not None:
        page.locator("math-field").click()
        page.wait_for_function("() => document.activeElement && document.activeElement.tagName === 'MATH-FIELD' && document.activeElement.hasFocus()")
        page.keyboard.type(typed, delay=40)
        page.wait_for_function("(t) => document.querySelector('#ae-latex-source').value.replace(/\\s/g, '') === t.replace(/\\s/g, '')", arg=typed)
    if latex is not None:
        page.fill("#ae-latex-source", latex)
    expect(page.locator('[role="dialog"] .katex').first).to_be_visible()
    page.get_by_role("button", name="Save equation").click()
    page.wait_for_selector("math-field", state="detached")


def excalidraw_canvas(page):
    page.wait_for_selector(".excalidraw canvas.interactive", timeout=60000)
    page.wait_for_timeout(500)
    return page.locator(".excalidraw canvas.interactive").bounding_box()


def drag(page, x1, y1, x2, y2):
    page.mouse.move(x1, y1)
    page.mouse.down()
    page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, steps=5)
    page.mouse.move(x2, y2, steps=5)
    page.mouse.up()


@step("1. Write text, equation, text, diagram, table and code in one answer")
def build_mixed_answer(page):
    ed = editor(page)
    ed.click()
    page.keyboard.type("Proof by induction.")
    page.keyboard.press("Enter")
    page.get_by_test_id("insert-math-block").click()
    math_dialog_save(page, latex="\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}")
    expect(page.locator(".ae-math-block .katex")).to_have_count(1)
    page.keyboard.type("Base case: ")
    page.get_by_test_id("insert-math-inline").click()
    math_dialog_save(page, typed="n=1")
    page.keyboard.type(" holds trivially.")
    page.keyboard.press("Enter")
    page.keyboard.type("Diagram of the recursion:")

    page.get_by_test_id("insert-diagram").click()
    box = excalidraw_canvas(page)
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.keyboard.press("r")
    drag(page, cx - 250, cy - 60, cx - 100, cy + 40)
    page.keyboard.press("Escape")
    page.keyboard.press("a")
    drag(page, cx - 102, cy - 10, cx + 60, cy - 10)
    page.keyboard.press("Escape")
    page.keyboard.press("t")
    page.mouse.click(cx - 220, cy + 90)
    page.keyboard.type("Node A")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.screenshot(path=f"{SHOTS}/diagram-editor.png")
    page.get_by_role("button", name="Save diagram").click()
    page.wait_for_selector(".ae-diagram-svg", timeout=30000)

    page.keyboard.press("ArrowDown")
    page.get_by_test_id("insert-table").click()
    page.locator('.ae-popover input[type="number"]').first.fill("2")
    page.locator('.ae-popover input[type="number"]').nth(1).fill("2")
    page.get_by_test_id("insert-table-confirm").click()
    page.keyboard.type("n")
    page.keyboard.press("Tab")
    page.keyboard.type("cost")
    page.keyboard.press("Tab")
    page.keyboard.type("8")
    page.keyboard.press("Tab")
    page.keyboard.type("24")
    expect(page.locator(".ae-table-row")).to_be_visible()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")

    page.get_by_test_id("insert-code").click()
    page.wait_for_selector(".ae-code .cm-content")
    page.wait_for_function("() => document.activeElement && document.activeElement.classList.contains('cm-content')")
    page.keyboard.type("def f(x):")
    page.keyboard.press("Enter")
    page.keyboard.type("if x:")
    page.keyboard.press("Enter")
    page.keyboard.type("return 'a\\\\b'  # tab→")
    page.keyboard.insert_text("\t")
    page.keyboard.type("end")
    wait_saved(page)
    page.screenshot(path=f"{SHOTS}/student-mixed-answer.png", full_page=True)

    doc, row = server_doc(Q_ESSAY)
    types = [n["type"] for n in blocks(doc)]
    assert types == ["paragraph", "mathBlock", "paragraph", "paragraph", "diagram", "table", "codeBlock"], types
    b = blocks(doc)
    assert b[1]["attrs"]["latex"] == "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}", b[1]
    inline = [c for c in b[2]["content"] if c["type"] == "mathInline"]
    assert inline and inline[0]["attrs"]["latex"] == "n=1", b[2]
    els = b[4]["attrs"]["scene"]["elements"]
    kinds = sorted(e["type"] for e in els)
    assert {"rectangle", "arrow", "text"} <= set(kinds), kinds
    assert any(e.get("text") == "Node A" for e in els)
    rect = next(e for e in els if e["type"] == "rectangle")
    arrow = next(e for e in els if e["type"] == "arrow")
    assert (arrow.get("startBinding") or {}).get("elementId") == rect["id"], arrow.get("startBinding")
    cells = [c["content"][0]["content"][0]["text"] for r in b[5]["content"] for c in r["content"]]
    assert cells == ["n", "cost", "8", "24"], cells
    code = b[6]["attrs"]["code"]
    assert code == "def f(x):\n    if x:\n        return 'a\\\\b'  # tab→\tend", repr(code)
    assert b[6]["attrs"]["language"] == "python"
    assert all(n["attrs"].get("id") for n in b if n["type"] != "paragraph" or n.get("attrs"))
    assert row["client_seq"] > 0 and row["revision"] >= 1


@step("2. Edit every component after insertion")
def edit_components(page):
    page.locator(".ae-math-block .ae-math").click()
    math_dialog_save(page, latex="\\sum_{i=1}^{n} i^2 = \\frac{n(n+1)(2n+1)}{6}")
    page.locator(".ae-math-inline .ae-math").click()
    page.wait_for_selector("math-field")
    assert page.input_value("#ae-latex-source") == "n=1"
    math_dialog_save(page, latex="n = 1 \\Rightarrow 1 = \\tfrac{1 \\cdot 2}{2}")

    page.locator(".ae-code .cm-content").click()
    page.keyboard.press("Control+End")
    page.keyboard.press("Enter")
    page.keyboard.type("print(f(1))")
    page.locator(".ae-code select").select_option("cpp")

    page.get_by_role("button", name="Edit diagram").click()
    box = excalidraw_canvas(page)
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.keyboard.press("o")
    drag(page, cx + 120, cy - 60, cx + 260, cy + 40)
    page.keyboard.press("Escape")
    page.get_by_role("button", name="Save diagram").click()
    page.wait_for_selector(".ae-diagram-svg")
    page.wait_for_function("() => !document.querySelector('.ae-diagram-note')")
    wait_layout_stable(page, '[data-testid="unified-editor"] .ae-prose')

    page.locator(".ae-prose td").first.click()
    page.wait_for_function("() => { const e = document.querySelector('[data-testid=unified-editor] .ae-prose').editor; return !!e && (e.isActive('tableCell') || e.isActive('tableHeader')) }")
    page.keyboard.press("End")
    page.keyboard.type("0")
    wait_saved(page)

    doc, _ = server_doc(Q_ESSAY)
    b = blocks(doc)
    assert b[1]["attrs"]["latex"] == "\\sum_{i=1}^{n} i^2 = \\frac{n(n+1)(2n+1)}{6}", b[1]
    assert [c for c in b[2]["content"] if c["type"] == "mathInline"][0]["attrs"]["latex"] == "n = 1 \\Rightarrow 1 = \\tfrac{1 \\cdot 2}{2}", b[2]
    code_lines = b[6]["attrs"]["code"].split("\n")
    assert len(code_lines) == 4 and code_lines[-1].strip() == "print(f(1))", code_lines
    assert code_lines[:3] == ["def f(x):", "    if x:", "        return 'a\\\\b'  # tab→\tend"], code_lines
    assert b[6]["attrs"]["language"] == "cpp", b[6]["attrs"]["language"]
    assert b[4]["type"] == "diagram", [(n["type"], list((n.get("attrs") or {}).keys())) for n in b]
    assert "ellipse" in {e["type"] for e in b[4]["attrs"]["scene"]["elements"]}, b[4]["attrs"]["scene"]["elements"]
    assert b[5]["content"][1]["content"][0]["content"][0]["content"][0]["text"] == "80"


@step("3/5/6/7/8. Refresh restores everything exactly")
def reload_restores(page):
    before, _ = server_doc(Q_ESSAY)
    page.reload()
    page.wait_for_selector('[data-testid="unified-editor"] .ae-prose', timeout=60000)
    page.wait_for_selector(".ae-diagram-svg", timeout=30000)
    expect(page.locator(".ae-math-block .katex")).to_have_count(1)
    expect(page.locator(".ae-math-inline .katex")).to_have_count(1)
    code_text = page.locator(".ae-code .cm-content").evaluate("el => Array.from(el.querySelectorAll('.cm-line')).map(l => l.textContent).join('\\n')")
    _, row = server_doc(Q_ESSAY)
    saved_code = blocks(json.loads(row["response"])["doc"])[6]["attrs"]["code"]
    assert code_text == saved_code, (code_text, saved_code)
    texts = page.locator(".ae-prose td, .ae-prose th").all_inner_texts()
    assert [t.strip() for t in texts] == ["n", "cost", "80", "24"], texts
    page.wait_for_timeout(2500)
    after, _ = server_doc(Q_ESSAY)
    assert after == before, "reload must not change the saved document"
    page.locator(".ae-math-block .ae-math").click()
    page.wait_for_selector("math-field")
    assert page.input_value("#ae-latex-source") == "\\sum_{i=1}^{n} i^2 = \\frac{n(n+1)(2n+1)}{6}"
    page.get_by_role("button", name="Cancel").click()


TRICKY = "\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix} \\forall x \\notacommand{y} \"q\" ü"


@step("5. LaTeX is never altered; invalid LaTeX is kept verbatim with a clear error")
def latex_exactness(page):
    editor(page).locator("p").first.click()
    page.keyboard.press("Control+End")
    page.get_by_test_id("insert-math-block").click()
    page.wait_for_selector("math-field")
    page.fill("#ae-latex-source", TRICKY)
    page.wait_for_timeout(1500)
    assert page.input_value("#ae-latex-source") == TRICKY, page.input_value("#ae-latex-source")
    expect(page.get_by_text("Cannot render")).to_be_visible()
    page.get_by_role("button", name="Save equation").click()
    expect(page.locator(".ae-math-error")).to_have_count(1)
    expect(page.locator(".ae-math-error code")).to_have_text(TRICKY)
    wait_saved(page)
    doc, _ = server_doc(Q_ESSAY)
    assert blocks(doc)[7] == {"type": "mathBlock", "attrs": {"latex": TRICKY, "id": blocks(doc)[7]["attrs"]["id"]}}, blocks(doc)[7]


@step("13. Short-answer question only offers its allowed tools; pasted code/table is stripped")
def short_permissions(page):
    page.get_by_role("button", name="2", exact=True).click()
    page.wait_for_selector('[data-testid="unified-editor"] .ae-prose')
    ids = page.locator('[data-testid^="insert-"]').evaluate_all("els => els.map(e => e.dataset.testid)")
    assert ids == ["insert-math-inline", "insert-math-block"], ids
    editor(page).click()
    page.keyboard.type("A limit L means: ")
    page.get_by_test_id("insert-math-inline").click()
    math_dialog_save(page, latex="\\forall \\varepsilon>0\\ \\exists \\delta>0")
    editor(page).evaluate("""el => {
        const dt = new DataTransfer();
        dt.setData('text/html', '<pre data-language="python">import os</pre><table><tr><td>x</td></tr></table><p>pasted ok</p>');
        dt.setData('text/plain', 'import os x pasted ok');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }""")
    doc = wait_server_contains(Q_SHORT, "pasted ok")
    wait_saved(page)
    used = json.dumps(doc)
    assert '"codeBlock"' not in used and '"table"' not in used, used
    assert "pasted ok" in used and "\\\\forall" in used


@step("4. Navigating between questions keeps answers; objective questions keep their own UI")
def navigation(page):
    page.get_by_role("button", name="3", exact=True).click()
    expect(page.get_by_text("Pick the even number")).to_be_visible()
    expect(page.locator('[data-testid="unified-editor"]')).to_have_count(0)
    expect(page.locator(".ae-toolbar")).to_have_count(0)
    page.locator("section").get_by_role("button", name="4", exact=True).click()
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="1", exact=True).click()
    page.wait_for_selector(".ae-diagram-svg", timeout=30000)
    expect(page.locator(".ae-math-block .katex")).to_have_count(1)
    page.get_by_role("button", name="2", exact=True).click()
    expect(page.locator(".ae-math-inline .katex")).to_have_count(1)
    expect(page.locator(".ae-prose")).to_contain_text("pasted ok")
    _, rows = api(f"/attempts/{INFO['attempt']}/answers", INFO["student_token"])
    mcq = next(r for r in rows if r["question_id"] == Q_MCQ)
    assert mcq["response"] == "4", mcq


@step("10. Network failure never shows 'Saved'; work is retried and saved after recovery")
def network_failure(page):
    page.get_by_role("button", name="1", exact=True).click()
    page.wait_for_selector(".ae-diagram-svg", timeout=30000)
    page.route("**/api/v1/attempts/*/answer", lambda route: route.abort())
    editor(page).locator("p").first.click()
    page.keyboard.press("End")
    page.keyboard.type(" OFFLINE-EDIT")
    page.wait_for_function("() => document.querySelector('[data-testid=\"save-status\"]').dataset.status === 'retrying'", timeout=15000)
    for _ in range(6):
        assert page.locator('[data-testid="save-status"]').get_attribute("data-status") != "saved"
        page.wait_for_timeout(500)
    doc, _ = server_doc(Q_ESSAY)
    assert "OFFLINE-EDIT" not in json.dumps(doc)
    page.unroute("**/api/v1/attempts/*/answer")
    wait_saved(page, timeout=30000)
    doc, _ = server_doc(Q_ESSAY)
    assert "OFFLINE-EDIT" in json.dumps(doc)


@step("9. Rapid edits: the newest content always wins")
def rapid_edits(page):
    editor(page).locator("p").first.click()
    page.keyboard.press("End")
    page.keyboard.type(" " + "abcdefghij" * 4, delay=5)
    page.keyboard.type(" FINAL")
    wait_saved(page)
    page.wait_for_timeout(2000)
    doc, row = server_doc(Q_ESSAY)
    first_text = "".join(c.get("text", "") for c in blocks(doc)[0]["content"])
    assert first_text.endswith("abcdefghij" * 4 + " FINAL"), first_text
    status, res = api(f"/attempts/{INFO['attempt']}/answer", INFO["student_token"], "POST",
                      {"question_id": Q_ESSAY, "response": json.dumps({"format": "unisphere.answer", "schema_version": 1, "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "STALE"}]}]}}), "client_seq": 1})
    assert status == 200 and res["stale"] is True
    doc2, _ = server_doc(Q_ESSAY)
    assert doc2 == doc


@step("14. Malicious payloads are rejected by the server")
def malicious(page):
    bad = {"format": "unisphere.answer", "schema_version": 1, "doc": {"type": "doc", "content": [{"type": "diagram", "attrs": {"scene": {"elements": [{"id": "x", "type": "embeddable", "link": "javascript:alert(1)"}]}}}]}}
    status, _ = api(f"/attempts/{INFO['attempt']}/answer", INFO["student_token"], "POST", {"question_id": Q_ESSAY, "response": json.dumps(bad), "client_seq": 10**15 * 5})
    assert status == 400
    code_in_short = {"format": "unisphere.answer", "schema_version": 1, "doc": {"type": "doc", "content": [{"type": "codeBlock", "attrs": {"language": "python", "code": "x"}}]}}
    status, _ = api(f"/attempts/{INFO['attempt']}/answer", INFO["student_token"], "POST", {"question_id": Q_SHORT, "response": json.dumps(code_in_short), "client_seq": 10**15 * 5})
    assert status == 400


@step("11. Final submission preserves the full document and order; editor becomes read-only")
def submit(page):
    before, _ = server_doc(Q_ESSAY)
    editor(page).locator("p").first.click()
    page.keyboard.press("End")
    page.keyboard.type(" LAST-SECOND")
    page.get_by_role("button", name="Submit Exam").click()
    page.locator('[role="dialog"]').get_by_role("button", name="Submit Exam").click()
    page.wait_for_selector('[data-testid="submitted-page"]', timeout=30000)
    _, attempt = api(f"/attempts/{INFO['attempt']}", INFO["student_token"])
    assert attempt["status"] == "submitted", attempt
    doc, _ = server_doc(Q_ESSAY)
    assert "LAST-SECOND" in json.dumps(doc), "pending edit must be flushed before submit"
    assert [n["type"] for n in blocks(doc)] == [n["type"] for n in blocks(before)]
    status, _ = api(f"/attempts/{INFO['attempt']}/answer", INFO["student_token"], "POST", {"question_id": Q_ESSAY, "response": "", "client_seq": 10**15 * 9})
    assert status == 400


@step("12. Teacher reviews the submitted answer read-only, with identical content")
def teacher_review(page):
    before, _ = server_doc(Q_ESSAY)
    page = page.context.new_page()
    page.set_default_timeout(20000)
    page.goto(f"{APP}#mode=teacher&exam={INFO['exam']}&token={INFO['teacher_token']}")
    page.get_by_text("Sam Student").first.click()
    view = page.locator('[data-testid="answer-view"]').first
    view.wait_for(timeout=30000)
    page.wait_for_selector('[data-testid="answer-view"] .ae-diagram-svg', timeout=30000)
    expect(view.locator(".ae-math-block .katex")).to_have_count(1)
    expect(view.locator(".ae-math-inline .katex")).to_have_count(1)
    expect(view.locator(".ae-math-error code")).to_have_text(TRICKY)
    expect(view.locator(".cm-content")).to_contain_text("print(f(1))")
    saved_code = next(n for n in before["content"] if n["type"] == "codeBlock")["attrs"]["code"]
    shown = view.locator(".cm-content").evaluate("el => Array.from(el.querySelectorAll('.cm-line')).map(l => l.innerText).join('\\n')")
    style = view.locator(".cm-content").evaluate("el => getComputedStyle(el).whiteSpace")
    assert shown == saved_code, (shown, saved_code, style)
    expect(view.locator("td").first).to_have_text("80")
    assert view.locator(".ae-prose").get_attribute("contenteditable") == "false"
    assert view.locator(".cm-content").get_attribute("contenteditable") == "false"
    expect(page.locator(".ae-toolbar")).to_have_count(0)
    expect(page.get_by_role("button", name="Edit diagram")).to_have_count(0)
    view.locator(".ae-math-block .ae-math").first.click()
    expect(page.locator("math-field")).to_have_count(0)
    page.screenshot(path=f"{SHOTS}/teacher-review.png", full_page=True)
    card = page.locator("div.rounded-xl", has=page.locator('[data-testid="answer-view"]')).first
    card.locator('input[type="number"]').fill("9")
    card.get_by_role("button", name="Save Grade").click()
    page.wait_for_timeout(1500)
    after, row = server_doc(Q_ESSAY)
    assert after == before, "grading must not modify the student's answer"
    _, rows = api(f"/attempts/{INFO['attempt']}/answers", INFO["teacher_token"])
    assert next(r for r in rows if r["question_id"] == Q_ESSAY)["marks_awarded"] == 9


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
        ctx = browser.new_context(viewport={"width": 1400, "height": 1000}, permissions=["camera", "microphone", "clipboard-read", "clipboard-write"])
        page = ctx.new_page()
        page.set_default_timeout(20000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        open_student(page)
        try:
            for fn in (build_mixed_answer, edit_components, reload_restores, latex_exactness, short_permissions, navigation,
                       network_failure, rapid_edits, malicious, submit, teacher_review):
                fn(page)
        except Exception:
            page.screenshot(path=f"{SHOTS}/failure.png", full_page=True)
            print("page errors:", errors[:5])
            raise
        assert not errors, errors
        browser.close()
    print(f"\nALL {len(RESULTS)} E2E STEPS PASSED")


if __name__ == "__main__":
    main()