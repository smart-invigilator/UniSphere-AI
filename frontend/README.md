# Proctor — AI Exam Monitoring System (Frontend)

React + Tailwind app for a course/exam-based AI proctoring system. Teachers
manage courses and exams; students join via enrollment or exam code, pass a
real pre-exam security checklist (camera, microphone, screen share, ArcFace
identity enrollment, head-turn liveness), then take the exam under live
AI proctoring — including continuous identity re-verification that flags if
the person in front of the camera changes.

Talks to the FastAPI backend in `../backend` over REST + Socket.IO — there is
no mock data layer anymore; every page reads real data.

## Stack
- React 18 + Vite + Tailwind CSS (class-based dark mode)
- React Router
- Recharts (analytics)
- Socket.IO client, scoped per exam session
- Real `getUserMedia` / `getDisplayMedia` + Web Audio API for the checklist

## Run

```bash
npm install
cp .env.example .env      # point VITE_API_URL at your backend
npm run dev                # http://localhost:5173
npm run build               # production build into dist/
```

By default it targets `http://localhost:8000` (see `src/services/api.js`).
Start the backend first (see `../backend/README.md`), or use the combined
`docker compose up` from the backend folder, which also builds this frontend.

## Key flows

- **Student**: `/student/dashboard` → join a course by code, join an exam by
  code (must be enrolled) → `/student/checklist/:examId` (real permission +
  ArcFace + liveness checks) → `/student/exam/:examId` (real question engine,
  live proctoring stream) → `/student/exam-submitted`.
- **Teacher**: `/teacher/courses` (create course, manage roster) →
  `/teacher/create-exam` (pick course, build MCQ/TF/Short questions with
  answer keys, configure security toggles, publish) →
  `/teacher/monitoring/:examId` (real-time student grid, live frame
  thumbnails, alert feed) → `/teacher/grading/:examId` (grade short answers).

## Folder structure

```
src/
  components/     Reusable UI (cards, charts, live feeds, modal, navbar, toasts)
  context/        AuthContext, ExamContext, MonitorContext, ProctorSessionContext
  hooks/          useFilteredStudents
  services/       api.js (REST client), socket.js (real Socket.IO client)
  utils/          media.js (frame capture helpers), format.js
  pages/
    student/      StudentDashboard, PreExamCheck, ExamPage, ExamSubmitted
    teacher/      TeacherDashboard, CoursesPage, CourseDetail, ExamsPage,
                   CreateExam, LiveMonitoring, GradingPage, StudentsPage,
                   ReportsPage, SettingsPage
```

## Notes

- `ProctorSessionContext` lives at the app root (never unmounts on route
  change) so the camera/mic/screen-share `MediaStream`s obtained during the
  checklist survive the navigation into the exam page — browsers only allow
  `getDisplayMedia` to be requested once per user gesture, so this is the
  only reliable way to carry it forward without re-prompting.
- `LiveFeed` renders a real `<video>` bound to a `MediaStream` when given one
  (self-view, checklist), and falls back to a simulated placeholder canvas
  otherwise. The teacher's Live Monitoring grid shows real per-student JPEG
  frame thumbnails once frames start arriving over the socket.
