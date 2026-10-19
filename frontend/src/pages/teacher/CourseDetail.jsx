import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, UserPlus, Copy, Trash2, FileText, Plus } from 'lucide-react'
import { api } from '../../services/api'
import { useExams } from '../../context/ExamContext'
import { STATUS_META } from '../../data/examData'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'
import Avatar from '../../components/Avatar'

export default function CourseDetail() {
  const { courseId } = useParams()
  const { exams: allExams, refresh } = useExams()
  const [course, setCourse] = useState(null)
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, r] = await Promise.all([
        api.get(`/courses/${courseId}`),
        api.get(`/courses/${courseId}/roster`),
      ])
      setCourse(c)
      setRoster(r)
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => { load() }, [load])

  const courseExams = allExams.filter((e) => String(e.course_id) === String(courseId))

  const addStudent = async (e) => {
    e.preventDefault()
    setError(null)
    setAdding(true)
    try {
      await api.post(`/courses/${courseId}/students`, { email })
      setEmail('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const removeStudent = async (studentId) => {
    await api.delete(`/courses/${courseId}/students/${studentId}`)
    await load()
  }

  const copyCode = () => {
    navigator.clipboard?.writeText(course.code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (loading || !course) {
    return <main className="mx-auto max-w-[1200px] px-4 py-6"><p className="text-sm text-slate-400">Loading…</p></main>
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6">
      <Link to="/teacher/courses" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> All courses
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{course.subject || 'General'}</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{course.title}</h1>
          {course.description && <p className="mt-1 max-w-xl text-sm text-slate-500 dark:text-slate-400">{course.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copyCode} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs font-semibold text-slate-600 hover:text-brand-600 dark:bg-slate-800 dark:text-slate-300">
            <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied!' : course.code}
          </button>
          <Button as={Link} to="/teacher/create-exam" size="sm" icon={Plus}>New Exam</Button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* Exams */}
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Exams</h2>
          <div className="mt-2 space-y-2">
            {courseExams.map((exam) => (
              <div key={exam.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"><FileText className="h-4 w-4" /></span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{exam.title}</p>
                    <p className="text-xs text-slate-400">{exam.duration_minutes} min · {exam.question_count} questions</p>
                  </div>
                </div>
                <Badge color={exam.is_closed ? STATUS_META.closed.color : (STATUS_META[exam.status]?.color || 'slate')}>
                  {exam.is_closed ? STATUS_META.closed.label : (STATUS_META[exam.status]?.label || exam.status)}
                </Badge>
              </div>
            ))}
            {courseExams.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
                No exams in this course yet.
              </p>
            )}
          </div>
        </div>

        {/* Roster */}
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Roster ({roster.length})</h2>
          <form onSubmit={addStudent} className="mt-2 flex gap-1.5">
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="student@campus.edu" className="input flex-1 text-xs"
            />
            <Button type="submit" size="sm" icon={UserPlus} disabled={adding}>{adding ? '…' : 'Add'}</Button>
          </form>
          {error && <p className="mt-1.5 text-[11px] font-medium text-rose-600">{error}</p>}

          <div className="mt-3 space-y-1.5">
            {roster.map((s) => (
              <div key={s.student_id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Avatar name={s.name} size="sm" />
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">{s.name}</p>
                    <p className="text-[10px] text-slate-400">{s.email}</p>
                  </div>
                </div>
                <button onClick={() => removeStudent(s.student_id)} className="text-slate-300 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {roster.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-[11px] text-slate-400 dark:border-slate-700">
                No students enrolled yet. Add by email, or share the course code above for self-enrollment.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}