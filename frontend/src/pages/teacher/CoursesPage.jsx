import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Copy, Users, FileText, BookOpen } from 'lucide-react'
import { useExams } from '../../context/ExamContext'
import Button from '../../components/common/Button'
import Modal from '../../components/common/Modal'
import EmptyState from '../../components/common/EmptyState'

export default function CoursesPage() {
  const { courses, createCourse, loading } = useExams()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', subject: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(code)
    setTimeout(() => setCopied(null), 1500)
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await createCourse(form)
      setOpen(false)
      setForm({ title: '', subject: '', description: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Courses</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Create a course, then add exams and students to it.
          </p>
        </div>
        <Button icon={Plus} onClick={() => setOpen(true)}>New Course</Button>
      </div>

      {!loading && courses.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={BookOpen}
            title="No courses yet"
            message="Create your first course to start adding exams and enrolling students."
            action={<Button icon={Plus} onClick={() => setOpen(true)}>New Course</Button>}
          />
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link
              key={c.id}
              to={`/teacher/courses/${c.id}`}
              className="rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{c.subject || 'General'}</p>
                  <h2 className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">{c.title}</h2>
                </div>
              </div>
              {c.description && (
                <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{c.description}</p>
              )}
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.student_count} students</span>
                <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {c.exam_count} exams</span>
              </div>
              <button
                onClick={(e) => { e.preventDefault(); copyCode(c.code) }}
                className="mt-3 inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-500 hover:text-brand-600 dark:bg-slate-800 dark:text-slate-400"
              >
                <Copy className="h-3 w-3" /> {copied === c.code ? 'Copied!' : c.code}
              </button>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a course"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || !form.title.trim()}>{saving ? 'Creating…' : 'Create Course'}</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-3">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>}
          <Field label="Course title">
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Database Systems"
              className="input"
            />
          </Field>
          <Field label="Subject">
            <input
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="e.g. Computer Science"
              className="input"
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Short description students will see"
              className="input"
            />
          </Field>
        </form>
      </Modal>
    </main>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  )
}
