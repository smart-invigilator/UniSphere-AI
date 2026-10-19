from datetime import datetime
from pydantic import BaseModel, Field, field_validator

QUESTION_TYPES = {"mcq", "tf", "short"}


class SecuritySettings(BaseModel):
    camera: bool = True
    microphone: bool = True
    screenShare: bool = True
    identity: bool = True
    liveness: bool = True


class QuestionIn(BaseModel):
    type: str
    text: str = Field(min_length=1)
    options: list[str] | None = None
    correct_answer: str | None = None
    marks: int = 1

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v):
        if v not in QUESTION_TYPES:
            raise ValueError(f"type must be one of {QUESTION_TYPES}")
        return v


class QuestionOut(BaseModel):
    id: int
    type: str
    text: str
    options: list[str] | None
    marks: int
    order: int

    class Config:
        from_attributes = True


class QuestionAnswerKeyOut(QuestionOut):
    correct_answer: str | None


class ExamCreate(BaseModel):
    course_id: int
    title: str = Field(min_length=2, max_length=160)
    description: str = ""
    duration_minutes: int = Field(default=60, ge=1, le=600)
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    security: SecuritySettings = SecuritySettings()
    questions: list[QuestionIn] = []


class ExamUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description: str = ""
    duration_minutes: int = Field(default=60, ge=1, le=600)
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    security: SecuritySettings = SecuritySettings()
    questions: list[QuestionIn] = []


class ExamOut(BaseModel):
    id: int
    course_id: int
    course_title: str | None = None
    title: str
    description: str
    code: str
    duration_minutes: int
    total_marks: int
    scheduled_start: datetime | None
    scheduled_end: datetime | None
    status: str
    is_closed: bool = False
    security: dict
    question_count: int = 0
    created_at: datetime
    my_attempt_status: str | None = None
    my_final_score: float | None = None
    my_auto_score: float | None = None

    class Config:
        from_attributes = True


class ExamJoinByCode(BaseModel):
    code: str = Field(min_length=3, max_length=20)