import os
import sys
import tempfile

_DB = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_DB}")
os.environ.setdefault("FACE_MODEL_PATH", "/nonexistent/arcface.onnx")
os.environ.setdefault("OBJECT_MODEL_PATH", "/nonexistent/yolo.onnx")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db.session import Base, engine, SessionLocal
from app import models  # noqa: F401
from app.api import exams, attempts
from app.core.refs import ATTEMPT, COURSE, EXAM, decode_ref, encode_ref
from app.core.security import create_access_token, hash_password
from app.models.user import User, Role
from app.models.student import Student
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.attempt import ExamAttempt


@pytest.fixture()
def world():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(exams.router, prefix="/api/v1")
    app.include_router(attempts.router, prefix="/api/v1")
    db = SessionLocal()
    teacher = User(name="T", email="t@x.com", password=hash_password("x"), role=Role.teacher)
    student_user = User(name="S", email="s@x.com", password=hash_password("x"), role=Role.student)
    db.add_all([teacher, student_user])
    db.flush()
    student = Student(user_id=student_user.id, student_id="S1")
    db.add(student)
    db.flush()
    course = Course(title="Algorithms", teacher_id=teacher.id)
    db.add(course)
    db.flush()
    db.add(Enrollment(course_id=course.id, student_id=student.id))
    db.commit()
    ctx = {
        "client": TestClient(app),
        "db": db,
        "course_id": encode_ref(COURSE, course.id),
        "student_pk": student.id,
        "T": {"Authorization": "Bearer " + create_access_token(str(teacher.id), "teacher")},
        "S": {"Authorization": "Bearer " + create_access_token(str(student_user.id), "student")},
    }
    yield ctx
    db.close()


def start_attempt(ctx, exam_id):
    db = ctx["db"]
    a = ExamAttempt(exam_id=decode_ref(EXAM, exam_id), student_id=ctx["student_pk"], status="in_progress")
    db.add(a)
    db.commit()
    return encode_ref(ATTEMPT, a.id)