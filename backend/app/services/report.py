"""PDF exam-integrity report generation for a single attempt.

Fix: the old version used only the built-in Helvetica font, which supports
Latin-1 characters only. Any exam title, course name, student name or alert
text containing a character such as an en dash, smart quote, "·", "…" or
Urdu/Arabic text raised FPDFUnicodeEncodingException -> HTTP 500 -> the
download silently failed in the browser. The report now uses a Unicode TTF
font when one is available on the machine (Arial on Windows, DejaVu on
Linux) and otherwise safely converts text to Latin-1 instead of crashing.
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

    def clean(self, text) -> str:
        text = "" if text is None else str(text)
        if self.unicode_font:
            return text
        for k, v in _LATIN1_REPLACEMENTS.items():
            text = text.replace(k, v)
        return text.encode("latin-1", "replace").decode("latin-1")

    def line_text(self, text, h: float = 6):
        """One full-width line of text, then move to the next line."""
        self.cell(0, h, self.clean(text), new_x="LMARGIN", new_y="NEXT")

    def para(self, text, h: float = 7):
        self.multi_cell(0, h, self.clean(text), new_x="LMARGIN", new_y="NEXT")


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


def build_attempt_report(attempt: ExamAttempt, db: DBSession) -> bytes:
    risk = compute_risk(attempt.id, db)
    alerts = db.scalars(
        select(Alert).where(Alert.attempt_id == attempt.id).order_by(Alert.timestamp.asc())
    ).all()

    exam = attempt.exam
    student = attempt.student
    student_user = student.user if student is not None else None
    course = exam.course if exam is not None else None

    pdf = _ReportPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.font("B", 18)
    pdf.line_text("Exam Integrity Report", 10)
    pdf.font("", 10)
    pdf.set_text_color(110, 110, 110)
    pdf.line_text(f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    pdf.font("B", 13)
    pdf.para(exam.title if exam is not None else "Exam")
    pdf.font("", 11)
    pdf.line_text(f"Course: {course.title if course is not None else '-'}")
    student_name = student_user.name if student_user is not None else "-"
    student_code = student.student_id if student is not None else "-"
    pdf.line_text(f"Student: {student_name}  ({student_code})")
    pdf.line_text(f"Attempt #{attempt.id}  -  Status: {attempt.status}")
    if attempt.started_at:
        pdf.line_text(f"Started: {_fmt_dt(attempt.started_at)}")
    if attempt.submitted_at:
        pdf.line_text(f"Submitted: {_fmt_dt(attempt.submitted_at)}")
    pdf.ln(4)

    # --- Score summary ---
    pdf.font("B", 12)
    pdf.line_text("Score Summary", 8)
    pdf.font("", 11)
    total_marks = exam.total_marks if exam is not None else "-"
    final = attempt.final_score if attempt.final_score is not None else attempt.auto_score
    pdf.line_text(f"Auto-graded: {_num(attempt.auto_score)} / {_num(total_marks)}")
    pdf.line_text(f"Manually graded: {_num(attempt.manual_score)}")
    pdf.font("B", 11)
    pdf.line_text(f"Final score: {_num(final)} / {_num(total_marks)}")
    pdf.ln(4)

    # --- Integrity summary ---
    pdf.font("B", 12)
    pdf.line_text("Integrity Summary", 8)
    pdf.font("", 11)
    pdf.line_text(f"Suspicion score: {risk['suspicion_score']}")
    pdf.set_text_color(*SEVERITY_COLOR.get(risk["risk_level"], (0, 0, 0)))
    pdf.font("B", 11)
    pdf.line_text(f"Risk level: {str(risk['risk_level']).upper()}")
    pdf.set_text_color(0, 0, 0)
    pdf.font("", 11)
    c = risk["alert_counts"]
    pdf.line_text(
        f"Alerts - low: {c.get('low', 0)}   medium: {c.get('medium', 0)}   "
        f"high: {c.get('high', 0)}   (total {risk['total_alerts']})"
    )
    pdf.ln(4)

    # --- Violation timeline ---
    pdf.font("B", 12)
    pdf.line_text("Violation Timeline", 8)
    pdf.font("", 10)
    if not alerts:
        pdf.line_text("No violations recorded.")
    for a in alerts:
        pdf.set_text_color(*SEVERITY_COLOR.get(a.severity, (0, 0, 0)))
        ts = _fmt_dt(a.timestamp, "%H:%M:%S")
        conf = float(a.confidence or 0.0)
        pdf.line_text(f"[{ts}] {a.alert_type}  (severity: {a.severity}, confidence: {conf:.2f})")
    pdf.set_text_color(0, 0, 0)

    # --- High-severity screenshots ---
    shots = [a for a in alerts if a.severity == "high" and a.screenshot][:MAX_EMBEDDED_SCREENSHOTS]
    if shots:
        pdf.add_page()
        pdf.font("B", 12)
        pdf.line_text("High-Severity Violation Snapshots", 8)
        pdf.font("", 9)
        for a in shots:
            img = _decode_screenshot(a.screenshot)
            if img is None:
                continue
            pdf.line_text(f"{a.alert_type}  -  {_fmt_dt(a.timestamp, '%H:%M:%S')}")
            try:
                pdf.image(img, w=80)
            except Exception:
                pdf.line_text("(image could not be embedded)")
            pdf.ln(2)

    return bytes(pdf.output())