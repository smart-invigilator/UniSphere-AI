"""Seed an admin, a teacher, students, a course (with roster), and a
published exam with a mixed question set for testing.
Run: python -m app.seed
"""
from app.db.session import SessionLocal, Base, engine
from app.models.user import User, Role
from app.models.student import Student
from app.models.course import Course
from app.models.enrollment import Enrollment
from app.models.exam import ExamSession, Question
from app.core.security import hash_password

# Schema is created by Alembic (`alembic upgrade head`). This safety-net call
# is a no-op if migrations have already run, but lets `python -m app.seed`
# work standalone in a pinch (e.g. quick local sqlite testing).
Base.metadata.create_all(bind=engine)

DEPTS = ["Computer Science", "Electrical Eng.", "Mathematics", "Physics"]


def seed():
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == "admin@proctor.io").first():
            print("Already seeded.")
            return

        admin = User(name="Admin User", email="admin@proctor.io",
                     password=hash_password("admin123"), role=Role.admin)
        teacher = User(name="Dr. Sarah Nolan", email="teacher@proctor.io",
                       password=hash_password("teacher123"), role=Role.teacher)
        db.add_all([admin, teacher])
        db.flush()

        students = []
        for i in range(6):
            u = User(name=f"Student {i+1}", email=f"student{i+1}@proctor.io",
                     password=hash_password("student123"), role=Role.student)
            db.add(u)
            db.flush()
            st = Student(user_id=u.id, student_id=f"STU-{1000+u.id}",
                         department=DEPTS[i % len(DEPTS)], session_label="2024-2025",
                         attendance=90 + i)
            db.add(st)
            db.flush()
            students.append(st)

        course = Course(teacher_id=teacher.id, title="Database Systems",
                         subject="Computer Science",
                         description="Relational design, normalization, transactions, and SQL.")
        db.add(course)
        db.flush()

        # Enroll the first 4 seeded students; leave 2 unenrolled so the
        # self-enroll-by-code flow has someone to test with.
        for st in students[:4]:
            db.add(Enrollment(course_id=course.id, student_id=st.id, method="manual"))

        exam = ExamSession(
            course_id=course.id, title="Database Systems Final Exam",
            description="Comprehensive final covering relational design, normalization, "
                         "transactions, and SQL.",
            duration_minutes=45, total_marks=0, status="published",
            # identity: False — seeded students below have no
            # registration_face_image/embedding (there's no real photo to
            # generate one from in a non-interactive script), and
            # registration now mandates a live camera capture. These
            # accounts structurally cannot pass identity verification, so
            # the seeded exam turns that check off. All other checks
            # (camera, mic, screen share, liveness) stay on since none of
            # them depend on a pre-registered photo. To test the real
            # registration + identity-verification flow end-to-end,
            # register a brand-new account through the actual UI with a
            # working webcam instead of using these seeded accounts.
            security={
                "camera": True, "microphone": True, "screenShare": True,
                "identity": False, "liveness": True,
            },
        )
        db.add(exam)
        db.flush()

        questions = [
            Question(exam_id=exam.id, type="mcq", order=0, marks=4,
                     text="Which SQL clause is used to filter rows after aggregation?",
                     options=["WHERE", "HAVING", "GROUP BY", "ORDER BY"],
                     correct_answer="HAVING"),
            Question(exam_id=exam.id, type="mcq", order=1, marks=4,
                     text="Which normal form eliminates transitive dependencies?",
                     options=["1NF", "2NF", "3NF", "BCNF"],
                     correct_answer="3NF"),
            Question(exam_id=exam.id, type="tf", order=2, marks=2,
                     text="A foreign key can reference a non-unique column.",
                     options=["True", "False"], correct_answer="False"),
            Question(exam_id=exam.id, type="tf", order=3, marks=2,
                     text="Transactions in SQL follow the ACID properties.",
                     options=["True", "False"], correct_answer="True"),
            Question(exam_id=exam.id, type="short", order=4, marks=8,
                     text="Briefly explain the difference between a clustered and a "
                          "non-clustered index."),
        ]
        db.add_all(questions)
        exam.total_marks = sum(q.marks for q in questions)
        db.commit()

        print("Seeded:")
        print("  admin@proctor.io / admin123")
        print("  teacher@proctor.io / teacher123  (owns 'Database Systems', code:", course.code, ")")
        print("  student1..6@proctor.io / student123  (student1-4 enrolled, 5-6 free to self-enroll)")
        print("  Exam 'Database Systems Final Exam' published, code:", exam.code)
        print("  NOTE: seeded students have no registration face photo, so the seeded")
        print("        exam has identity verification turned OFF. To test the real")
        print("        registration + identity-verification flow, register a new")
        print("        account through the actual UI with a working webcam.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
