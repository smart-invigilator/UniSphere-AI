from sqlalchemy import String, ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base



class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    student_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    department: Mapped[str] = mapped_column(String(120), default="")
    registration_face_embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    registration_face_image: Mapped[str | None] = mapped_column(Text, nullable=True)
    face_scan_templates: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    session_label: Mapped[str] = mapped_column(String(40), default="")
    attendance: Mapped[int] = mapped_column(Integer, default=100)

    user: Mapped["User"] = relationship(back_populates="student_profile")
    alerts: Mapped[list["Alert"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    enrollments: Mapped[list["Enrollment"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    attempts: Mapped[list["ExamAttempt"]] = relationship(back_populates="student", cascade="all, delete-orphan")


from app.models.alert import Alert  
