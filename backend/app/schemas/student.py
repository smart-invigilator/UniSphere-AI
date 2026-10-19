from pydantic import BaseModel


class StudentOut(BaseModel):
    id: int
    student_id: str
    name: str
    department: str
    session_label: str
    attendance: int
    status: str = "normal"
    attention: int = 100
    alert_count: int = 0
    connected: bool = False

    class Config:
        from_attributes = True


class StudentUpdate(BaseModel):
    department: str | None = None
    session_label: str | None = None
    attendance: int | None = None
