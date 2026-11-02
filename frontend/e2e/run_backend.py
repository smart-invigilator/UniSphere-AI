import json
import os
import sys
import tempfile
from datetime import datetime, timezone

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
WORK = tempfile.mkdtemp(prefix="ae-e2e-")
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(WORK, 'e2e.db')}"
os.environ["CORS_ORIGINS"] = "http://localhost:5174"
os.environ.setdefault("FACE_MODEL_PATH", "/nonexistent/arcface.onnx")
os.environ.setdefault("OBJECT_MODEL_PATH", "/nonexistent/yolo.onnx")
os.environ["MEDIA_ROOT"] = os.path.join(WORK, "media")
sys.path.insert(0, BACKEND)
os.chdir(WORK)

import uvicorn
from app.main import socket_app
from app.db.session import Base, engine, SessionLocal
from app.core.security import create_access_token, hash_password
from app.models.user import User, Role
from app.models.student import Student
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.exam import ExamSession, Question
from app.models.attempt import ExamAttempt

ALL = ["math", "code", "diagram", "table"]

Base.metadata.create_all(engine)
db = SessionLocal()
teacher = User(name="Dr. Teacher", email="t@e2e.io", password=hash_password("x"), role=Role.teacher)
su = User(name="Sam Student", email="s@e2e.io", password=hash_password("x"), role=Role.student)
db.add_all([teacher, su]); db.flush()
st = Student(user_id=su.id, student_id="E2E-1"); db.add(st); db.flush()
course = Course(title="Discrete Math", teacher_id=teacher.id); db.add(course); db.flush()
db.add(Enrollment(course_id=course.id, student_id=st.id))
exam = ExamSession(course_id=course.id, title="Unified editor exam", duration_minutes=120, total_marks=20, status="published",
                   security={"camera": True, "microphone": True, "screenShare": True, "identity": False, "liveness": False, "calculator": True})
db.add(exam); db.flush()
questions = [
    Question(exam_id=exam.id, type="essay", text="Prove $\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$ and explain.\n| n | sum |\n|---|---|\n| 3 | 6 |", marks=10, order=0,
             settings={"word_limit": 500, "allowed_components": ALL}),
    Question(exam_id=exam.id, type="short", text="Write the definition of a limit.", marks=5, order=1,
             settings={"allowed_components": ["math"]}),
    Question(exam_id=exam.id, type="mcq", text="Pick the even number", options=["3", "4"], correct_answer="4", marks=5, order=2, settings={}),
]
db.add_all(questions); db.flush()
attempt = ExamAttempt(exam_id=exam.id, student_id=st.id, status="in_progress", started_at=datetime.now(timezone.utc),
                      camera_ok=True, microphone_ok=True, screen_ok=True)
db.add(attempt); db.commit()

info = {
    "exam": exam.id,
    "attempt": attempt.id,
    "questions": [q.id for q in questions],
    "student_token": create_access_token(str(su.id), "student"),
    "teacher_token": create_access_token(str(teacher.id), "teacher"),
}
with open(os.environ.get("E2E_INFO", "/tmp/ae_e2e_info.json"), "w") as fh:
    json.dump(info, fh)
print("E2E backend ready", info["exam"], info["attempt"], flush=True)
uvicorn.run(socket_app, host="127.0.0.1", port=8001, log_level="warning")