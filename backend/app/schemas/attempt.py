from datetime import datetime
from pydantic import BaseModel, Field

class AttemptOut(BaseModel):
    id: int
    exam_id: int
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
    response: str = ""


class AnswerOut(BaseModel):
    question_id: int
    response: str
    is_correct: bool | None
    marks_awarded: float
    feedback: str = ""

    class Config:
        from_attributes = True


class GradeAnswerIn(BaseModel):
    marks_awarded: float = Field(ge=0)
    feedback: str = ""


class SubmitExamOut(BaseModel):
    attempt_id: int
    status: str
    auto_score: float
    total_marks: int
    ungraded_questions: int
    submitted_at: datetime
