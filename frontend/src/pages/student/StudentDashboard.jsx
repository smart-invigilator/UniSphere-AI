import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Clock, BookOpen, CheckCircle2, CalendarClock, ArrowRight, AlertCircle, GraduationCap, Plus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useExams } from '../../context/ExamContext'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'
import Modal from '../../components/common/Modal'
import { STATUS_META } from '../../data/examData'

function ScoreSummary({ exam }) {
  const total = exam.total_marks
  const fmt = (n) => (Number.isInteger(n) ? n : Number(n).toFixed(2).replace(/\.?0+$/, ''))
  if (exam.my_attempt_status === 'graded' && exam.my_final_score != null) {
    return (
      <span className="font-semibold text-emerald-700 dark:text-emerald-400" data-testid="final-score">
        Score: {fmt(exam.my_final_score)} / {total}
      </span>
    )
  }
  if (exam.my_attempt_status === 'submitted') {
    const soFar = (exam.my_auto_score || 0) + (exam.my_manual_score || 0)
    const pending = exam.my_pending_grading || 0
    return (
      <span className="flex flex-col gap-0.5 text-slate-500 dark:text-slate-400" data-testid="partial-score">
        <span className="font-semibold text-slate-700 dark:text-slate-200">Score so far: {fmt(soFar)} / {total}</span>
        <span>{pending > 0 ? `${pending} answer${pending === 1 ? '' : 's'} awaiting teacher grading` : 'Awaiting teacher grading'}</span>
      </span>
    )
  }
  return <span className="text-slate-400">Not attempted</span>
}

// Derive a student-facing status from the teacher-side exam status.
function studentStatus(exam) {
  // Already finished this exam — show as Completed regardless of the
  // exam's own global state, which only reflects "is this exam open for
  // *someone*", not "has *this* student already taken it". This is the
  // actual fix for exams reappearing as joinable right after submitting.
  if (exam.my_attempt_status === 'submitted' || exam.my_attempt_status === 'graded') return 'completed'
  // A closed exam (deadline passed) shouldn't appear as joinable at all —
  // showing it as "Available" would just lead to a confusing rejected-join
  // attempt, since the backend independently enforces this same deadline.
  if (exam.is_closed) return null
  if (exam.status === 'active') return 'available'
  if (exam.status === 'completed') return 'completed'
  if (exam.status === 'published') return 'available'
  return null
}

export default function StudentDashboard() {
  const { user } = useAuth()
  const { exams, courses, refresh, joinExamByCode, enrollByCode } = useExams()
  const navigate = useNavigate()

  useEffect(() => {
    refresh()
  }, [refresh])

  const [codeOpen, setCodeOpen] = useState(false)
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  const [courseCodeOpen, setCourseCodeOpen] = useState(false)
  const [courseCode, setCourseCode] = useState('')
  const [enrolling, setEnrolling] = useState(false)
  const [courseError, setCourseError] = useState('')

  const visible = useMemo(
    () => exams.map((e) => ({ ...e, studentStatus: studentStatus(e) })).filter((e) => e.studentStatus),
    [exams]
  )

  const counts = useMemo(
    () => ({
      available: visible.filter((e) => e.studentStatus === 'available').length,
      completed: visible.filter((e) => e.studentStatus === 'completed').length,
      courses: courses.length,
    }),
    [visible, courses]
  )

  const joinByCode = async (e) => {
    e.preventDefault()
    setJoining(true)
    setError('')
    try {
      const attempt = await joinExamByCode(code.trim().toUpperCase())
      navigate(`/student/checklist/${attempt.exam_id}`)
    } catch (err) {
      setError(err.message || 'Could not join with that code.')
    } finally {
      setJoining(false)
    }
  }

  const joinCourseByCode = async (e) => {
    e.preventDefault()
    setEnrolling(true)
    setCourseError('')
    try {
      await enrollByCode(courseCode.trim().toUpperCase())
      setCourseCodeOpen(false)
      setCourseCode('')
    } catch (err) {
      setCourseError(err.message || 'Could not enroll with that code.')
    } finally {
      setEnrolling(false)
    }
  }

  const joinExam = (exam) => navigate(`/student/checklist/${exam.id}`)

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Welcome back, {user?.name?.split(' ')[0]}</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Here's what's happening with your exams.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" icon={Plus} onClick={() => { setCourseCodeOpen(true); setCourseError('') }}>Join Course</Button>
          <Button icon={KeyRound} onClick={() => { setCodeOpen(true); setError('') }}>Join Exam Session</Button>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard icon={GraduationCap} label="Enrolled Courses" value={counts.courses} accent="violet" />
        <SummaryCard icon={BookOpen} label="Available Now" value={counts.available} accent="emerald" />
        <SummaryCard icon={CheckCircle2} label="Completed" value={counts.completed} accent="brand" />
      </div>

      {/* Courses */}
      {courses.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Your Courses</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {courses.map((c) => (
              <span key={c.id} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {c.title} <span className="text-slate-400">· {c.teacher_name}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Exams */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Your Exams</h2>
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            No exams available yet. {courses.length === 0 && 'Join a course with your course code to get started.'}
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((exam) => (
              <div
                key={exam.id}
                role={exam.studentStatus === 'completed' && exam.my_attempt_id ? 'button' : undefined}
                tabIndex={exam.studentStatus === 'completed' && exam.my_attempt_id ? 0 : undefined}
                onClick={() => exam.studentStatus === 'completed' && exam.my_attempt_id && navigate(`/student/exam-results/${exam.my_attempt_id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    if (exam.studentStatus === 'completed' && exam.my_attempt_id) navigate(`/student/exam-results/${exam.my_attempt_id}`)
                  }
                }}
                className={`flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${
                  exam.studentStatus === 'completed' && exam.my_attempt_id ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/40' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{exam.title}</p>
                    <p className="text-xs text-slate-400">{exam.course_title}</p>
                  </div>
                  <Badge color={STATUS_META[exam.studentStatus]?.color || 'slate'}>{STATUS_META[exam.studentStatus]?.label || exam.studentStatus}</Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {exam.duration_minutes} min</span>
                  <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" /> {exam.total_marks} marks</span>
                  {exam.scheduled_start && (
                    <span className="col-span-2 flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> {new Date(exam.scheduled_start).toLocaleString()}</span>
                  )}
                </div>

                <div className="mt-4 flex-1" />
                {exam.studentStatus === 'available' ? (
                  <Button className="w-full" size="sm" iconRight={ArrowRight} onClick={() => joinExam(exam)}>Join Exam</Button>
                ) : (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-center text-xs dark:bg-slate-800">
                    <ScoreSummary exam={exam} />
                    {exam.my_attempt_id && <p className="mt-1 text-[11px] font-medium text-brand-600 dark:text-brand-400">Click to view details</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal open={codeOpen} onClose={() => setCodeOpen(false)} title="Join Exam Session">
        <form onSubmit={joinByCode} className="space-y-3">
          <div>
            <label htmlFor="examCode" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Exam Code</label>
            <input
              id="examCode"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="EXAM-8F29X"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm tracking-wide focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <p className="mt-1.5 text-[11px] text-slate-400">You must already be enrolled in the exam's course to join.</p>
          </div>
          {error && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600"><AlertCircle className="h-3.5 w-3.5" /> {error}</p>
          )}
          <Button type="submit" className="w-full" disabled={joining}>{joining ? 'Joining…' : 'Join Session'}</Button>
        </form>
      </Modal>

      <Modal open={courseCodeOpen} onClose={() => setCourseCodeOpen(false)} title="Join a Course">
        <form onSubmit={joinCourseByCode} className="space-y-3">
          <div>
            <label htmlFor="courseCode" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Course Code</label>
            <input
              id="courseCode"
              autoFocus
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
              placeholder="CRS-9A9FB2"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm tracking-wide focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <p className="mt-1.5 text-[11px] text-slate-400">Get this code from your instructor.</p>
          </div>
          {courseError && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600"><AlertCircle className="h-3.5 w-3.5" /> {courseError}</p>
          )}
          <Button type="submit" className="w-full" disabled={enrolling}>{enrolling ? 'Joining…' : 'Join Course'}</Button>
        </form>
      </Modal>
    </main>
  )
}

function SummaryCard({ icon: Icon, label, value, accent }) {
  const accents = {
    brand: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10 dark:text-brand-400',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400',
    violet: 'text-violet-600 bg-violet-50 dark:bg-violet-500/10 dark:text-violet-400',
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${accents[accent]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  )
}