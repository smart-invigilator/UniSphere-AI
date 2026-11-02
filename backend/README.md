# AI Proctor — Backend

FastAPI + PostgreSQL + Socket.IO backend for a course/exam-based AI proctoring
system: teachers own courses, create exam sessions under them, and enrolled
students join via the course roster or an exam code. Every exam attempt is
monitored with a server-side computer-vision pipeline (face presence, gaze,
head pose, blink/drowsiness, optional object detection) **plus ArcFace-based
identity re-verification**, which detects if the person in front of the
camera changes partway through the exam.

## What this is

- **Courses & enrollment** — teachers create courses; students join by adding
  them manually (by email) or via a course code (self-enroll).
- **Exam sessions** — created under a course with MCQ / True-False / Short
  Answer questions, a duration, optional schedule window, and per-exam
  security toggles (camera / microphone / screen share / identity / liveness).
  Exam codes only work for students already enrolled in the course.
- **Full exam engine** — students answer questions, autosave per-answer,
  submit; MCQ/TF auto-grade instantly, short answers wait for the teacher to
  grade manually. Final score combines both once grading is complete.
- **Pre-exam checklist** — real browser permission checks (camera,
  microphone, screen share), real ArcFace face enrollment, and a real
  head-turn liveness check (rejects a static photo held up to the camera).
- **Identity re-verification during the exam** — the enrolled ArcFace
  embedding is compared against fresh webcam frames throughout the exam;
  repeated mismatches raise a "Different Person Detected" alert in real time.
- **Realtime monitoring** — Socket.IO rooms scoped per exam session, so a
  teacher's Live Monitoring view for Exam A never sees Exam B's students.
- **Auth** — JWT access + refresh tokens, bcrypt hashing, RBAC
  (admin / teacher / student).

## Quick start — Docker (recommended)

```bash
docker compose up --build
```
This starts Postgres, runs migrations, seeds test data, and serves the API on
`:8000`. Combine with the frontend's own `docker-compose.yml` service (already
wired in) or run `../frontend` separately with `npm run dev`.

## Quick start — manual (Postgres already running)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                 # edit SECRET_KEY and DATABASE_URL
alembic upgrade head
python -m app.seed                   # creates test users, a course, and a published exam
uvicorn app.main:socket_app --reload --port 8000
```

Interactive API docs: http://localhost:8000/docs
Health check (also reports whether the AI + ArcFace models loaded):
http://localhost:8000/health

### Seeded test accounts
| Role    | Email                  | Password    | Notes |
|---------|------------------------|-------------|-------|
| Admin   | admin@proctor.io       | admin123    | |
| Teacher | teacher@proctor.io     | teacher123  | Owns course "Database Systems" |
| Student | student1..4@proctor.io | student123  | Enrolled in the seeded course |
| Student | student5..6@proctor.io | student123  | Not enrolled — use to test self-enroll by course code |

The seed script prints the generated course code and exam code each run.

**Note:** seeded students have no registration reference photo (there's no
real photo to generate one from in a non-interactive script — registration
now requires a live camera capture, see below), so the seeded exam has
`security.identity` turned off. To test the real registration and identity-
verification flow end-to-end, register a new account through the actual UI
with a working webcam rather than using the seeded accounts for that part.

## Registration & identity verification

Student registration now requires capturing a reference photo via webcam
before the account can be created: **Open Camera → Take Photo → Preview →
Retake (as many times as needed) or Use This Photo**. The confirmed photo is
what gets stored (`students.registration_face_image`, plus a cached
`registration_face_embedding` derived from it) and is the permanent ground
truth every future exam identity check compares against — there is no
separate "build a new reference" step during the exam checklist anymore; the
pre-exam "Identity" step verifies the student's live camera feed against this
same registered photo instead. This needs `ENABLE_AI=true` and
`ENABLE_FACE_ID=true` with a working ArcFace model (see below) — without
them, student registration itself will return a 503 until the models are
installed.

## Enabling the AI engine

The behavior pipeline (face mesh, gaze, head pose, blink) needs `numpy`,
`opencv-python(-headless)`, and `mediapipe` (already in requirements.txt) and
`ENABLE_AI=true`. Without them the analyzer returns neutral metrics rather
than crashing, so auth/API/socket wiring still works for testing.

For object detection (phone/book/external screen), export a YOLOv8 ONNX model
into `models/`:
```bash
pip install ultralytics
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx')"
mv yolov8n.onnx models/
```

### Enabling identity re-ID (ArcFace)

Identity enrollment/verification needs an ArcFace ONNX model at
`models/arcface.onnx` and `ENABLE_FACE_ID=true`. It is **not bundled** (same
policy as the YOLO model above — keeps the repo light and lets you pick a
licensed model of your choice). A common way to obtain one:

```bash
pip install insightface onnx
python - <<'PY'
import insightface
app = insightface.app.FaceAnalysis(name="buffalo_l")
# The recognition sub-model, typically named w600k_r50.onnx in the
# downloaded buffalo_l pack (~/.insightface/models/buffalo_l/), is the
# ArcFace embedding model. Copy/rename that file to models/arcface.onnx.
PY
```

Without this file, `/health` reports `face_id_ready: false`, student
registration is unavailable (503), and in-exam re-verification is skipped
gracefully rather than blocking the app — but `security.identity: true` on
an exam will still block students at `/attempts/{id}/enter` until it's
available, so either install the model or turn that security toggle off for
exams created without it.

Tunable via env vars: `FACE_MATCH_THRESHOLD` (cosine similarity, default
0.38), `FACE_CHECK_EVERY` (analyze 1 of every N sampled frames, default 5),
`FACE_MISMATCH_STREAK` (consecutive low-similarity frames before alerting,
default 3), `FACE_QUALITY_MIN_STD` / `FACE_QUALITY_MIN_SHARPNESS` (face-crop
texture thresholds used to detect an occluded/covered face before trusting
any similarity score — these are reasonable starting points, not validated
against real hardware; watch actual values against your camera and adjust),
`FACE_QUALITY_STREAK_FRAMES` (consecutive occluded checks before alerting
"Face Covered", default 4).

## Socket.IO event contract (scoped per exam)

**Student → Server:** `student:join {token, attempt_id}`,
`frame:webcam {image}`, `frame:screen {image}`, `heartbeat {}`
**Dashboard → Server:** `dashboard:join {token, exam_id}`
**Server → Dashboard/Student (room `exam:{id}`):** `students:init [...]`,
`students:tick [...]`, `alert {alert, student}`,
`frame:webcam {studentId, image}`, `frame:screen {studentId, image}`

## Folder structure

```
app/
  api/        auth, courses, exams, attempts, students, alerts, analytics
  core/       config, JWT/password security
  db/         SQLAlchemy engine + session
  models/     ORM models (User, Student, Course, Enrollment, ExamSession,
              Question, ExamAttempt, Answer, Alert, MonitoringEvent, ...)
  schemas/    Pydantic request/response models
  ai/         analyzer.py (behavior pipeline), face_id.py (ArcFace identity)
  realtime/   Socket.IO server + per-exam connection manager
  main.py     FastAPI app + Socket.IO ASGI wrapper
  seed.py     test data (course, enrollments, published exam with questions)
alembic/      migrations (0001_initial_schema covers the full schema)
docker/       nginx reverse-proxy config
Dockerfile, docker-compose.yml
```

## Security notes

JWT auth, bcrypt hashing, RBAC on every protected route, enrollment checks
before course/exam access, CORS allowlist, and basic rate limiting (slowapi)
are in place. Before production: set a strong `SECRET_KEY`, serve over
HTTPS/WSS, and restrict CORS to your real origins.
