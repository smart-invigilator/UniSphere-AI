from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class CourseCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    subject: str = ""
    description: str = ""


class CourseOut(BaseModel):
    id: int
    title: str
    subject: str
    description: str
    code: str
    teacher_id: int
    teacher_name: str | None = None
    student_count: int = 0
    exam_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class EnrollByEmail(BaseModel):
    email: EmailStr


class EnrollByCode(BaseModel):
    code: str = Field(min_length=3, max_length=20)


class RosterStudentOut(BaseModel):
    student_id: str
    name: str
    email: str
    department: str
    enrolled_at: datetime
    method: str

    class Config:
        from_attributes = True
