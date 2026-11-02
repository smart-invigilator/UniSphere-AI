from pydantic import BaseModel, EmailStr, Field, field_validator
from app.models.user import Role

SCAN_LABELS = {
    "front", "left_25", "left_45", "left_65", "profile_left",
    "right_25", "right_45", "right_65", "profile_right",
}


class ScanFrameIn(BaseModel):
    label: str
    image: str = Field(min_length=100, max_length=1_500_000)

    @field_validator("label")
    @classmethod
    def _valid_label(cls, v):
        if v not in SCAN_LABELS:
            raise ValueError("Unknown scan view")
        return v


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    role: Role = Role.student
    student_id: str | None = None
    department: str | None = None
    face_scan: list[ScanFrameIn] | None = Field(default=None, max_length=30)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: Role
    name: str


class LoginOut(BaseModel):
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    role: Role
    name: str
    face_required: bool = False
    face_token: str | None = None
    face_enrolled: bool = True


class FaceLoginIn(BaseModel):
    face_token: str = Field(min_length=10, max_length=2000)
    face_scan: list[ScanFrameIn] = Field(min_length=3, max_length=30)


class ScanFrameCheckIn(BaseModel):
    image: str = Field(min_length=100, max_length=1_500_000)


class ScanFrameCheckOut(BaseModel):
    ok: bool
    kind: str | None = None
    label: str | None = None
    yaw: float | None = None
    message: str = ""


class RefreshIn(BaseModel):
    refresh_token: str


class MeOut(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: Role
    student_id: str | None = None
    department: str | None = None
    face_scan_enrolled: bool = False