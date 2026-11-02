# Proctor — Course/Exam AI Proctoring System

A complete, runnable proctoring platform: teachers create courses and exam
sessions, students join by enrollment or exam code, and every exam attempt is
monitored by a real-time AI pipeline — including **ArcFace-based identity
re-verification** that detects if the person in front of the camera changes
partway through the exam.

- `backend/` — FastAPI + PostgreSQL + Socket.IO (see `backend/README.md`)
- `frontend/` — React + Vite + Tailwind (see `frontend/README.md`)

## Quickest way to run everything

```bash
cd backend
cp .env.example .env        # edit SECRET_KEY at minimum
docker compose up --build
```

This starts Postgres, runs migrations, seeds demo data, and serves:
- Backend API: http://localhost:8000 (docs at `/docs`)
- Frontend: http://localhost:5173

### Demo logins (from `app/seed.py`)
| Role    | Email                  | Password    |
|---------|-------------------------|-------------|
| Teacher | teacher@proctor.io      | teacher123  |
| Student | student1@proctor.io     | student123  |
| Admin   | admin@proctor.io        | admin123    |

`teacher@proctor.io` owns a seeded course ("Database Systems") with a
published exam, `student1`–`student4` are already enrolled, and
`student5`/`student6` are left unenrolled so you can test the self-enroll-by-
course-code flow.

## Running without Docker

**Backend** (needs a local Postgres):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install insightface onnx 
cp .env.example .env        # point DATABASE_URL at your local Postgres
alembic upgrade head
python -m app.seed
uvicorn app.main:socket_app --reload
```

**Frontend**:
```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_URL=http://localhost:8000
npm run dev
```

## Enabling face-based features

The behavior-analysis pipeline (face mesh, gaze, head pose, drowsiness) works
out of the box via MediaPipe. Two optional ONNX models unlock further
features and are **not bundled** (same policy — keeps the repo light, lets
you choose licensed/approved models):

- `backend/models/yolov8n.onnx` — phone/book/screen object detection
- `backend/models/arcface.onnx` — **identity re-verification (the "detect if
  the student changed" feature)**. See `backend/README.md` → "Enabling
  identity re-ID" for how to export one from insightface's `buffalo_l` pack.

Without `arcface.onnx`, `/health` reports `face_id_ready: false` and identity
checks are skipped — but any exam with `security.identity: true` will block
students at the final checklist step until the model is installed (or that
toggle is turned off when creating the exam).

## What's implemented

- Courses, enrollment (manual by teacher + self-enroll by code), exam
  sessions scoped to a course, exam codes that only work for enrolled students
- Full exam engine: MCQ / True-False (auto-graded) + Short Answer (manually
  graded), per-question marks, final score combining both
- Student registration captures a permanent reference photo (preview, retake,
  and confirm before saving) — mandatory for student accounts, since exam-time
  identity checks are compared against it. See "Registration & identity
  verification" below.
- Real pre-exam checklist: actual browser camera/mic/screen permissions, a
  live-camera check against the student's registered reference photo, real
  head-turn liveness check (rejects a static photo), re-verified on every
  checklist entry (including after a page reload)
- Continuous in-exam identity re-verification via ArcFace cosine similarity,
  with a face-visibility check that gates out occluded/covered frames before
  trusting a similarity score, raising examiner-only "Different Person
  Detected" and "Face Covered" alerts (never shown to the student)
- Realtime Socket.IO monitoring scoped per exam session, with live per-student
  webcam/screen frame thumbnails on the teacher's Live Monitoring grid
- PostgreSQL + Alembic migrations, JWT auth with refresh tokens, RBAC
