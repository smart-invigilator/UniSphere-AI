from pydantic import BaseModel, EmailStr, Field
from app.models.user import Role


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    role: Role = Role.student
    student_id: str | None = None
    department: str | None = None
    face_frames: list[str] | None = None
    reference_image: str | None = None
    face_scan_ticket: str | None = None   


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
    requires_face_scan: bool = False
    scan_token: str | None = None


class RefreshIn(BaseModel):
    refresh_token: str


class MeOut(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: Role
    student_id: str | None = None
    department: str | None = None
