import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Clock, BookOpen, CheckCircle2, CalendarClock, ArrowRight, AlertCircle, GraduationCap, Plus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useExams } from '../../context/ExamContext'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'
import Modal from '../../components/common/Modal'
import { STATUS_META } from '../../data/examData'

function studentStatus(exam) {
  if (exam.my_attempt_status === 'submitted' || exam.my_attempt_status === 'graded') return 'completed'
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
              <div key={exam.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
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
                    {exam.my_final_score != null ? (
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        Final score: {exam.my_final_score} / {exam.total_marks}
                      </span>
                    ) : exam.my_auto_score != null ? (
                      <span className="text-slate-500 dark:text-slate-400">
                        Auto-graded: {exam.my_auto_score} / {exam.total_marks}
                      </span>
                    ) : (
                      <span className="text-slate-400">Submitted — awaiting grading</span>
                    )}
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