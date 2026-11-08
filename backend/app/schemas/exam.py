import re
from datetime import datetime, timedelta, timezone
from typing import Any
from pydantic import BaseModel, Field, field_validator, model_validator
from app.core.refs import AttemptOut_, CourseIn, CourseOut_, ExamOut_
from app.services.question_types import QUESTION_TYPES, normalize_question

MEDIA_URL_RE = re.compile(r"^/media/questions/[A-Za-z0-9_\-]+/[A-Za-z0-9_\-]+\.(png|jpg|gif|webp)$")


class SecuritySettings(BaseModel):
    """Every proctoring check is mandatory (whatever the client sends is overridden).
    The calculator is the only teacher-controlled tool."""
    camera: bool = True
    microphone: bool = True
    screenShare: bool = True
    identity: bool = True
    liveness: bool = True
    calculator: bool = True

    @model_validator(mode="after")
    def _proctoring_mandatory(self):
        for name in ("camera", "microphone", "screenShare", "identity", "liveness"):
            setattr(self, name, True)
        return self


def _derive_window(exam) -> None:
    """The closing time is never user-supplied: it is opening time + duration (all UTC)."""
    exam.scheduled_end = (
        exam.scheduled_start + timedelta(minutes=exam.duration_minutes) if exam.scheduled_start else None
    )


class MediaItem(BaseModel):
    url: str = Field(max_length=300)
    name: str = Field(default="", max_length=200)
    caption: str = Field(default="", max_length=500)

    @field_validator("url")
    @classmethod
    def _valid_url(cls, v):
        if not MEDIA_URL_RE.match(v):
            raise ValueError("Invalid media url, upload the image again")
        return v


class QuestionIn(BaseModel):
    type: str
    text: str = Field(min_length=1, max_length=20000)
    options: list[str] | None = None
    correct_answer: str | None = None
    marks: int = Field(default=1, ge=0, le=1000)
    media: list[MediaItem] = Field(default_factory=list, max_length=6)
    settings: dict[str, Any] = Field(default_factory=dict)
    answer_key: dict[str, Any] | None = None

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v):
        if v not in QUESTION_TYPES:
            raise ValueError(f"type must be one of {sorted(QUESTION_TYPES)}")
        return v

    @model_validator(mode="after")
    def _normalize(self):
        preview = self.text.strip()[:40]
        try:
            options, correct, settings, key = normalize_question(
                self.type, self.text, self.options, self.correct_answer,
                self.settings, self.answer_key, self.media,
            )
        except ValueError as exc:
            raise ValueError(f'Question "{preview}": {exc}')
        self.options = options
        self.correct_answer = correct
        self.settings = settings
        self.answer_key = key
        if self.type == "text_block":
            self.marks = 0
        elif self.marks < 1:
            raise ValueError(f'Question "{preview}": marks must be at least 1')
        return self


class QuestionOut(BaseModel):
    id: int
    type: str
    text: str
    options: list[str] | None = None
    marks: int
    order: int
    media: list[dict] = Field(default_factory=list)
    settings: dict[str, Any] = Field(default_factory=dict)


class QuestionAnswerKeyOut(QuestionOut):
    correct_answer: str | None = None
    answer_key: dict[str, Any] | None = None


class ExamCreate(BaseModel):
    course_id: CourseIn
    title: str = Field(min_length=2, max_length=160)
    description: str = ""
    duration_minutes: int = Field(default=60, ge=1, le=600)
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    security: SecuritySettings = SecuritySettings()
    questions: list[QuestionIn] = Field(default_factory=list, max_length=500)

    @field_validator("scheduled_start", "scheduled_end")
    @classmethod
    def _assume_utc(cls, v):
        if v is None:
            return v
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)

    @model_validator(mode="after")
    def _check_schedule(self):
        _derive_window(self)
        return self


class ExamUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description: str = ""
    duration_minutes: int = Field(default=60, ge=1, le=600)
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    security: SecuritySettings = SecuritySettings()
    questions: list[QuestionIn] | None = Field(default=None, max_length=500)

    @field_validator("scheduled_start", "scheduled_end")
    @classmethod
    def _assume_utc(cls, v):
        if v is None:
            return v
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)

    @model_validator(mode="after")
    def _check_schedule(self):
        _derive_window(self)
        return self


class ExamOut(BaseModel):
    id: ExamOut_
    course_id: CourseOut_
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
    my_attempt_id: AttemptOut_ | None = None
    my_attempt_status: str | None = None
    my_final_score: float | None = None
    my_auto_score: float | None = None
    my_manual_score: float | None = None
    my_pending_grading: int = 0
    has_attempts: bool = False

    class Config:
        from_attributes = True


class ExamJoinByCode(BaseModel):
    code: str = Field(min_length=3, max_length=20)