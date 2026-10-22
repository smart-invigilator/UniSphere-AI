import io
import base64
from datetime import datetime, timezone
from fpdf import FPDF
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import select
from app.models.attempt import ExamAttempt
from app.models.alert import Alert
from app.services.risk import compute_risk

SEVERITY_COLOR = {"low": (161, 98, 7), "medium": (194, 65, 12), "high": (185, 28, 28)}

MAX_EMBEDDED_SCREENSHOTS = 12


def _decode_screenshot(b64: str):
    try:
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        return io.BytesIO(base64.b64decode(b64))
    except Exception:
        return None


def build_attempt_report(attempt: ExamAttempt, db: DBSession, attempt_number: int) -> bytes:
    risk = compute_risk(attempt.id, db)
    alerts = db.scalars(
        select(Alert).where(Alert.attempt_id == attempt.id).order_by(Alert.timestamp.asc())
    ).all()

    exam = attempt.exam
    student_user = attempt.student.user

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, "Exam Integrity Report", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(110, 110, 110)
    pdf.cell(0, 6, f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", ln=True)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 13)
    pdf.multi_cell(0, 7, exam.title)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 6, f"Course: {exam.course.title}", ln=True)
    pdf.cell(0, 6, f"Student: {student_user.name}  ({attempt.student.student_id})", ln=True)
    pdf.cell(0, 6, f"Attempt #{attempt_number}  -  Status: {attempt.status}", ln=True)
    if attempt.started_at:
        pdf.cell(0, 6, f"Started: {attempt.started_at.strftime('%Y-%m-%d %H:%M UTC')}", ln=True)
    if attempt.submitted_at:
        pdf.cell(0, 6, f"Submitted: {attempt.submitted_at.strftime('%Y-%m-%d %H:%M UTC')}", ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Score Summary", ln=True)
    pdf.set_font("Helvetica", "", 11)
    total_marks = exam.total_marks
    final = attempt.final_score if attempt.final_score is not None else attempt.auto_score
    pdf.cell(0, 6, f"Auto-graded: {attempt.auto_score} / {total_marks}", ln=True)
    pdf.cell(0, 6, f"Manually graded: {attempt.manual_score}", ln=True)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, f"Final score: {final} / {total_marks}", ln=True)
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Integrity Summary", ln=True)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 6, f"Suspicion score: {risk['suspicion_score']}", ln=True)
    risk_color = SEVERITY_COLOR.get(
        {"low": "low", "medium": "medium", "high": "high"}.get(risk["risk_level"]), (0, 0, 0)
    )
    pdf.set_text_color(*risk_color)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, f"Risk level: {risk['risk_level'].upper()}", ln=True)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "", 11)
    c = risk["alert_counts"]
    pdf.cell(
        0, 6,
        f"Alerts - low: {c['low']}   medium: {c['medium']}   high: {c['high']}   "
        f"(total {risk['total_alerts']})",
        ln=True,
    )
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Violation Timeline", ln=True)
    pdf.set_font("Helvetica", "", 10)
    if not alerts:
        pdf.cell(0, 6, "No violations recorded.", ln=True)
    for a in alerts:
        pdf.set_text_color(*SEVERITY_COLOR.get(a.severity, (0, 0, 0)))
        ts = a.timestamp.strftime("%H:%M:%S")
        pdf.cell(0, 6, f"[{ts}] {a.alert_type}  (severity: {a.severity}, confidence: {a.confidence:.2f})", ln=True)
    pdf.set_text_color(0, 0, 0)
    shots = [
        a for a in alerts
        if a.severity in {"medium", "high"} and a.screenshot
    ][:MAX_EMBEDDED_SCREENSHOTS]
    if shots:
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, "Medium- and High-Severity Violation Snapshots", ln=True)
        pdf.set_font("Helvetica", "", 9)
        for a in shots:
            img = _decode_screenshot(a.screenshot)
            if img is None:
                continue
            ts = a.timestamp.strftime("%H:%M:%S")
            pdf.cell(0, 6, f"{a.alert_type}  -  {ts}", ln=True)
            try:
                pdf.image(img, w=80)
            except Exception:
                pdf.cell(0, 6, "(image could not be embedded)", ln=True)
            pdf.ln(2)

    return bytes(pdf.output())