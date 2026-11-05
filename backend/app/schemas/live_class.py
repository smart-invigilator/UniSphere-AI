import re
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field, field_validator

IDENTITY_RE = re.compile(r"^u\d{1,12}$")
REACTIONS = ("👍", "👏", "❤️", "😂", "😮", "🎉", "🤔", "✋")


def _utc(v):
    if v is None:
        return v
    return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v.astimezone(timezone.utc)


class LiveClassCreate(BaseModel):
    course_id: int
    title: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=5000)
    scheduled_start: datetime | None = None
    start_now: bool = False

    _norm = field_validator("scheduled_start")(classmethod(lambda cls, v: _utc(v)))


class LiveClassUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=5000)
    scheduled_start: datetime | None = None

    _norm = field_validator("scheduled_start")(classmethod(lambda cls, v: _utc(v)))


class LiveSettingsUpdate(BaseModel):
    chat_enabled: bool | None = None
    qa_enabled: bool | None = None
    locked: bool | None = None
    allow_student_mic: bool | None = None
    allow_student_camera: bool | None = None
    allow_student_screen: bool | None = None
    spotlight: str | None = Field(default=None, max_length=20)
    clear_spotlight: bool = False

    @field_validator("spotlight")
    @classmethod
    def _identity(cls, v):
        if v is not None and not IDENTITY_RE.match(v):
            raise ValueError("Invalid participant")
        return v


class LiveClassOut(BaseModel):
    id: int
    course_id: int
    course_title: str
    teacher_name: str
    title: str
    description: str
    status: str
    scheduled_start: datetime | None
    started_at: datetime | None
    ended_at: datetime | None
    meeting_code: str
    created_at: datetime
    my_role: str
    settings: dict


class JoinOut(BaseModel):
    url: str
    token: str
    identity: str
    role: str
    live_class: LiveClassOut


class ParticipantPermissionsIn(BaseModel):
    microphone: bool | None = None
    camera: bool | None = None
    screen: bool | None = None
    reset: bool = False


class MuteIn(BaseModel):
    source: Literal["microphone", "camera", "screen_share"] = "microphone"


class HandIn(BaseModel):
    raised: bool


class RequestIn(BaseModel):
    kind: Literal["speak", "screen", ""]


class MessageIn(BaseModel):
    kind: Literal["chat", "question"] = "chat"
    text: str = Field(min_length=1, max_length=1000)

    @field_validator("text")
    @classmethod
    def _strip(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Message cannot be empty")
        return v


class MessageOut(BaseModel):
    id: int
    kind: str
    text: str
    user_id: int
    identity: str
    name: str
    role: str
    answered: bool
    hidden: bool
    created_at: datetime


class ReactionIn(BaseModel):
    emoji: str

    @field_validator("emoji")
    @classmethod
    def _allowed(cls, v):
        if v not in REACTIONS:
            raise ValueError("Unsupported reaction")
        return v


class AttendanceRow(BaseModel):
    user_id: int
    name: str
    student_code: str | None = None
    role: str
    present: bool
    connected: bool
    first_joined_at: datetime | None = None
    last_left_at: datetime | None = None
    total_seconds: int
    join_count: int


class AttendanceOut(BaseModel):
    live_class_id: int
    status: str
    started_at: datetime | None
    ended_at: datetime | None
    duration_seconds: int
    enrolled: int
    present: int
    rows: list[AttendanceRow]