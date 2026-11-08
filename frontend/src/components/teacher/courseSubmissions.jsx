import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useExams } from '../../context/ExamContext'
import { api } from '../../services/api'
import { Badge } from '../common/EmptyState'

// Loads every attempt of the teacher's exams, numbers each student's attempts
// within a course (1, 2, 3...), and keeps only submitted / graded ones.
export function useCourseSubmissions() {
  const { exams, courses } = useExams()
  const [attempts, setAttempts] = useState([])

  useEffect(() => {
    if (exams.length === 0) return
    Promise.all(
      exams.map((e) =>
        api.get(`/attempts/exam/${e.id}`)
          .then((rows) => rows.map((r) => ({ ...r, examTitle: e.title, courseId: e.course_id })))
          .catch(() => [])
      )
    ).then((lists) => setAttempts(lists.flat()))
  }, [exams])

  const numbered = useMemo(() => {
    const counters = new Map()
    const numbers = new Map()
    // ids are opaque strings, so order attempts by start time (id as tiebreak)
    const startedAt = (a) => new Date(a.started_at || a.submitted_at || 0).getTime() || 0
    ;[...attempts].sort((a, b) => startedAt(a) - startedAt(b) || String(a.id).localeCompare(String(b.id))).forEach((a) => {
      const key = `${a.courseId}:${a.student_id}`
      const n = (counters.get(key) || 0) + 1
      counters.set(key, n)
      numbers.set(a.id, n)
    })
    return attempts.map((a) => ({ ...a, attemptNo: numbers.get(a.id) }))
  }, [attempts])

  const submitted = useMemo(
    () => numbered
      .filter((a) => a.status === 'submitted' || a.status === 'graded')
      .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0)),
    [numbered]
  )

  const courseCards = useMemo(() => courses.map((c) => {
    const list = submitted.filter((a) => a.courseId === c.id)
    return { ...c, submissions: list.length, pending: list.filter((a) => a.status === 'submitted').length }
  }), [courses, submitted])

  return { attempts: numbered, submitted, courseCards }
}

export function filterByStudent(list, query) {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((a) =>
    [a.student_name, a.student_email, a.student_code, a.examTitle]
      .some((v) => (v || '').toLowerCase().includes(q))
  )
}

export function SearchBox({ value, onChange, placeholder = 'Search students…' }) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="input w-full"
        style={{ paddingLeft: '2.25rem' }}
      />
    </div>
  )
}

export function CourseGrid({ cards, onSelect }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-500 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500"
        >
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{c.title}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">{c.subject || c.code}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge color="brand">{c.submissions} submission{c.submissions === 1 ? '' : 's'}</Badge>
            {c.pending > 0 && <Badge color="amber">{c.pending} to grade</Badge>}
          </div>
        </button>
      ))}
      {cards.length === 0 && (
        <p className="col-span-full rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900">No courses yet.</p>
      )}
    </div>
  )
}
