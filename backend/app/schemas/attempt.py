from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from app.core.refs import AttemptOut_, ExamOut_


class AttemptOut(BaseModel):
    id: AttemptOut_
    exam_id: ExamOut_
    student_id: int
    status: str
    started_at: datetime | None
    submitted_at: datetime | None
    auto_score: float
    manual_score: float
    final_score: float | None
    camera_ok: bool
    microphone_ok: bool
    screen_ok: bool
    identity_verified: bool
    liveness_ok: bool
    checklist_passed: bool
    student_name: str | None = None
    student_code: str | None = None
    student_email: str | None = None

    class Config:
        from_attributes = True


class ChecklistStepIn(BaseModel):
    passed: bool = True


class FaceFrameIn(BaseModel):
    image: str


class FaceEnrollIn(BaseModel):
    frames: list[str] = Field(min_length=1, max_length=8)


class FaceEnrollOut(BaseModel):
    identity_verified: bool
    frames_used: int
    message: str


class LivenessCheckIn(BaseModel):
    center_frame: str
    left_frame: str
    right_frame: str


class LivenessStepIn(BaseModel):
    step: str
    frame: str
    center_frame: str | None = None


class LivenessStepOut(BaseModel):
    step_ok: bool
    message: str


class LivenessCheckOut(BaseModel):
    liveness_ok: bool
    yaw_left: float | None = None
    yaw_right: float | None = None
    message: str


class IdentityCheckOut(BaseModel):
    similarity: float | None
    is_match: bool
    mismatch_streak: int
    alert_fired: bool


class AnswerIn(BaseModel):
    question_id: int
    response: str = Field(default="", max_length=3_000_000)
    client_seq: int | None = Field(default=None, ge=0, le=9_007_199_254_740_991)


class AnswerOut(BaseModel):
    question_id: int
    response: str
    is_correct: bool | None
    marks_awarded: float
    feedback: str = ""
    requires_manual: bool = False
    graded: bool = False
    client_seq: int = 0
    revision: int = 0
    stale: bool = False

    class Config:
        from_attributes = True


class GradeShortAnswerIn(BaseModel):
    marks_awarded: float
    feedback: str = Field(default="", max_length=5000)

    @field_validator("marks_awarded")
    @classmethod
    def _valid_marks(cls, v: float) -> float:
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError("Marks must be a number")
        if v < 0:
            raise ValueError("Marks cannot be negative")
        if round(v, 2) != round(v, 6):
            raise ValueError("Marks can have at most 2 decimal places")
        return round(v, 2)


class BulkGradeItemIn(GradeShortAnswerIn):
    question_id: int


class BulkGradeIn(BaseModel):
    grades: list[BulkGradeItemIn] = Field(min_length=1, max_length=500)


class MediaUploadOut(BaseModel):
    url: str
    name: str
    size: int
    content_type: str
    kind: str


class SubmitExamOut(BaseModel):
    attempt_id: AttemptOut_
    status: str
    auto_score: float
    total_marks: int
    ungraded_questions: int
    submitted_at: datetime