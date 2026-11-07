"""PDF exam-integrity report generation for a single attempt.

Uses a Unicode TTF font when one is available on the machine (Arial on
Windows, DejaVu on Linux) and otherwise safely converts text to Latin-1
instead of crashing on characters such as en dashes or smart quotes.
"""
import io
import os
import base64
from datetime import datetime, timezone
from fpdf import FPDF
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select
from app.models.attempt import ExamAttempt
from app.models.alert import Alert
from app.services.risk import compute_risk

SEVERITY_COLOR = {"low": (161, 98, 7), "medium": (194, 65, 12), "high": (185, 28, 28)}

# Only embed screenshots for high-severity alerts, and cap the count.
MAX_EMBEDDED_SCREENSHOTS = 12

NAVY = (30, 41, 82)
SLATE = (71, 85, 105)
MUTED = (110, 120, 135)
LIGHT_BG = (243, 246, 251)
BORDER = (214, 220, 230)
HIGH_BG = (254, 226, 226)

MARGIN = 14
PAGE_W = 210
CONTENT_W = PAGE_W - 2 * MARGIN

# (regular, bold) Unicode font candidates, first match wins.
_FONT_CANDIDATES = [
    (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf"),
    (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\segoeuib.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
    ("/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
]

# Replacements used only when no Unicode font is available.
_LATIN1_REPLACEMENTS = {
    "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"', "\u2026": "...", "\u00b7": "-", "\u2022": "-",
    "\u00a0": " ", "\u2192": "->",
}


def _decode_screenshot(b64: str):
    try:
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        return io.BytesIO(base64.b64decode(b64))
    except Exception:
        return None


class _ReportPDF(FPDF):
    def __init__(self):
        super().__init__()
        self.unicode_font = False
        self.family = "Helvetica"
        for regular, bold in _FONT_CANDIDATES:
            if os.path.exists(regular) and os.path.exists(bold):
                try:
                    self.add_font("ReportFont", "", regular)
                    self.add_font("ReportFont", "B", bold)
                    self.family = "ReportFont"
                    self.unicode_font = True
                    break
                except Exception:
                    continue

    def font(self, style: str = "", size: int = 11):
        self.set_font(self.family, style, size)

    def footer(self):
        self.set_xy(MARGIN, -12)
        self.font("", 8)
        self.set_text_color(*MUTED)
        self.cell(CONTENT_W / 2, 5, "UniSphere AI  -  Confidential exam integrity report")
        self.cell(CONTENT_W / 2, 5, f"Page {self.page_no()} of {{nb}}", align="R")

    def clean(self, text) -> str:
        text = "" if text is None else str(text)
        if self.unicode_font:
            return text
        for k, v in _LATIN1_REPLACEMENTS.items():
            text = text.replace(k, v)
        return text.encode("latin-1", "replace").decode("latin-1")


def _fmt_dt(value, fmt="%Y-%m-%d %H:%M UTC"):
    if value is None:
        return "-"
    try:
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
        return value.strftime(fmt)
    except Exception:
        return str(value)


def _num(value):
    if value is None:
        return "0"
    try:
        v = float(value)
        return str(int(v)) if v.is_integer() else f"{v:.2f}"
    except Exception:
        return str(value)


def _risk_color(level):
    return SEVERITY_COLOR.get(str(level).lower(), (22, 101, 52))


def _section_title(pdf, title):
    pdf.ln(3)
    pdf.set_x(MARGIN)
    pdf.font("B", 12)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 8, pdf.clean(title), new_x="LMARGIN", new_y="NEXT")
    y = pdf.get_y()
    pdf.set_draw_color(*NAVY)
    pdf.set_line_width(0.5)
    pdf.line(MARGIN, y, MARGIN + CONTENT_W, y)
    pdf.set_line_width(0.2)
    pdf.ln(3)
    pdf.set_text_color(0, 0, 0)


def _info_grid(pdf, rows):
    """Two-column grid of (label, value) pairs inside a light bordered card."""
    col_w = CONTENT_W / 2
    row_h = 13
    n_rows = (len(rows) + 1) // 2
    top = pdf.get_y()
    pdf.set_fill_color(*LIGHT_BG)
    pdf.set_draw_color(*BORDER)
    pdf.rect(MARGIN, top, CONTENT_W, n_rows * row_h + 4, style="DF")
    max_w = col_w - 8
    for idx, (label, value) in enumerate(rows):
        r, c = divmod(idx, 2)
        x = MARGIN + 4 + c * col_w
        y = top + 3 + r * row_h
        pdf.set_xy(x, y)
        pdf.font("", 8)
        pdf.set_text_color(*MUTED)
        pdf.cell(max_w, 4, pdf.clean(label.upper()))
        pdf.set_xy(x, y + 4.5)
        pdf.font("B", 10)
        pdf.set_text_color(20, 25, 40)
        text = pdf.clean(value)
        if pdf.get_string_width(text) > max_w:
            while len(text) > 1 and pdf.get_string_width(text + "...") > max_w:
                text = text[:-1]
            text += "..."
        pdf.cell(max_w, 5, text)
    pdf.set_y(top + n_rows * row_h + 4)
    pdf.set_text_color(0, 0, 0)


def _stat_cards(pdf, cards):
    """Row of equal cards: (label, value, (r, g, b) accent colour)."""
    gap = 4
    w = (CONTENT_W - gap * (len(cards) - 1)) / len(cards)
    top = pdf.get_y()
    h = 20
    for i, (label, value, color) in enumerate(cards):
        x = MARGIN + i * (w + gap)
        pdf.set_fill_color(255, 255, 255)
        pdf.set_draw_color(*BORDER)
        pdf.rect(x, top, w, h, style="DF")
        pdf.set_fill_color(*color)
        pdf.rect(x, top, 1.6, h, style="F")
        pdf.set_xy(x + 5, top + 3)
        pdf.font("", 8)
        pdf.set_text_color(*MUTED)
        pdf.cell(w - 7, 4, pdf.clean(label.upper()))
        pdf.set_xy(x + 5, top + 9)
        pdf.font("B", 14)
        pdf.set_text_color(*color)
        pdf.cell(w - 7, 8, pdf.clean(value))
    pdf.set_y(top + h)
    pdf.set_text_color(0, 0, 0)


def _image_height(img, width):
    try:
        from PIL import Image
        img.seek(0)
        with Image.open(img) as im:
            iw, ih = im.size
        img.seek(0)
        return width * ih / iw if iw else width * 0.75
    except Exception:
        img.seek(0)
        return width * 0.75


def build_attempt_report(attempt: ExamAttempt, db: DBSession) -> bytes:
    risk = compute_risk(attempt.id, db)
    alerts = db.scalars(
        select(Alert).where(Alert.attempt_id == attempt.id).order_by(Alert.timestamp.asc())
    ).all()

    exam = attempt.exam
    student = attempt.student
    student_user = student.user if student is not None else None
    course = exam.course if exam is not None else None
    teacher = getattr(course, "teacher", None) if course is not None else None

    pdf = _ReportPDF()
    pdf.alias_nb_pages()
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # --- Header band ---
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, PAGE_W, 34, style="F")
    pdf.set_xy(MARGIN, 8)
    pdf.font("B", 20)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(CONTENT_W, 9, "Exam Integrity Report", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(MARGIN)
    pdf.font("", 10)
    pdf.set_text_color(200, 210, 235)
    pdf.cell(CONTENT_W, 6, pdf.clean(exam.title if exam is not None else "Exam"),
             new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(MARGIN)
    pdf.font("", 8)
    pdf.cell(CONTENT_W, 5, f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    pdf.set_y(42)
    pdf.set_text_color(0, 0, 0)

    # --- Student & exam details ---
    student_name = student_user.name if student_user is not None else "-"
    student_code = student.student_id if student is not None else "-"
    course_name = course.title if course is not None else "-"
    if course is not None and getattr(course, "code", None):
        course_name = f"{course_name} ({course.code})"
    instructor = getattr(teacher, "name", None) or "-"

    _section_title(pdf, "Student & Exam Information")
    _info_grid(pdf, [
        ("Student name", student_name),
        ("Student ID", str(student_code)),
        ("Attempt", f"#{attempt.id}  -  {str(attempt.status).replace('_', ' ').title()}"),
        ("Exam", exam.title if exam is not None else "-"),
        ("Course", course_name),
        ("Instructor", instructor),
        ("Exam started", _fmt_dt(attempt.started_at)),
        ("Exam ended", _fmt_dt(attempt.submitted_at)),
    ])

    # --- Score summary ---
    total_marks = exam.total_marks if exam is not None else "-"
    final = attempt.final_score if attempt.final_score is not None else attempt.auto_score
    _section_title(pdf, "Score Summary")
    _stat_cards(pdf, [
        ("Auto-graded", f"{_num(attempt.auto_score)} / {_num(total_marks)}", SLATE),
        ("Manually graded", _num(attempt.manual_score), SLATE),
        ("Final score", f"{_num(final)} / {_num(total_marks)}", NAVY),
    ])

    # --- Integrity summary ---
    c = risk["alert_counts"]
    _section_title(pdf, "Integrity Summary")
    _stat_cards(pdf, [
        ("Suspicion score", str(risk["suspicion_score"]), SLATE),
        ("Risk level", str(risk["risk_level"]).upper(), _risk_color(risk["risk_level"])),
        ("Total alerts", str(risk["total_alerts"]), SLATE),
    ])
    pdf.ln(4)
    _stat_cards(pdf, [
        ("Low severity", str(c.get("low", 0)), SEVERITY_COLOR["low"]),
        ("Medium severity", str(c.get("medium", 0)), SEVERITY_COLOR["medium"]),
        ("High severity", str(c.get("high", 0)), SEVERITY_COLOR["high"]),
    ])

    # --- High-severity snapshots, two per row ---
    shots = []
    for a in alerts:
        if a.severity == "high" and a.screenshot:
            img = _decode_screenshot(a.screenshot)
            if img is not None:
                shots.append((a, img))
        if len(shots) >= MAX_EMBEDDED_SCREENSHOTS:
            break

    if shots:
        gap = 6
        col_w = (CONTENT_W - gap) / 2
        label_h = 7
        first_h = max(_image_height(img, col_w) for _, img in shots[:2]) + label_h + 4
        if pdf.get_y() + 14 + first_h > pdf.h - 18:
            pdf.add_page()
        _section_title(pdf, "High-Severity Violation Snapshots")
        for i in range(0, len(shots), 2):
            pair = shots[i:i + 2]
            heights = [_image_height(img, col_w) for _, img in pair]
            row_h = max(heights) + label_h + 4
            if pdf.get_y() + row_h > pdf.h - 18:
                pdf.add_page()
            top = pdf.get_y()
            for j, (a, img) in enumerate(pair):
                x = MARGIN + j * (col_w + gap)
                pdf.set_draw_color(*BORDER)
                pdf.set_fill_color(*HIGH_BG)
                pdf.rect(x, top, col_w, label_h, style="DF")
                pdf.set_xy(x + 2, top + 1)
                pdf.font("B", 8)
                pdf.set_text_color(*SEVERITY_COLOR["high"])
                label = f"{str(a.alert_type).replace('_', ' ').title()}  |  {_fmt_dt(a.timestamp, '%H:%M:%S')}"
                pdf.cell(col_w - 4, 5, pdf.clean(label))
                try:
                    pdf.image(img, x=x, y=top + label_h, w=col_w)
                    pdf.rect(x, top + label_h, col_w, heights[j], style="D")
                except Exception:
                    pdf.set_xy(x + 2, top + label_h + 2)
                    pdf.font("", 8)
                    pdf.set_text_color(*MUTED)
                    pdf.cell(col_w - 4, 5, "(image could not be embedded)")
            pdf.set_y(top + row_h)
            pdf.set_text_color(0, 0, 0)

    return bytes(pdf.output())
