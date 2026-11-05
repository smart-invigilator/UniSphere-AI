import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Radio, Loader2 } from 'lucide-react'
import { api } from '../../services/api'
import { useExams } from '../../context/ExamContext'
import Button from '../../components/common/Button'
import Modal from '../../components/common/Modal'
import { LiveClassCard } from '../../components/live/LiveClassList'
import { formatDuration } from '../../components/live/liveUtils'

function toLocalInput(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function CreateLiveClass({ open, onClose, courses, onCreated }) {
  const [form, setForm] = useState({ course_id: '', title: '', description: '', when: '', start_now: false })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      const soon = new Date(Date.now() + 60 * 60 * 1000)
      soon.setMinutes(0, 0, 0)
      setForm({ course_id: courses[0]?.id || '', title: '', description: '', when: toLocalInput(soon), start_now: false })
      setError(null)
    }
  }, [open, courses])
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const titleError = form.title.trim().length < 2 ? 'Enter a title of at least 2 characters.' : null
  const whenError = !form.start_now && (!form.when || new Date(form.when) < new Date(Date.now() - 60000)) ? 'Choose a start time in the future.' : null
  const submit = async () => {
    if (titleError || whenError || !form.course_id) return
    setSaving(true)
    setError(null)
    try {
      const lc = await api.post('/live-classes', {
        course_id: Number(form.course_id),
        title: form.title.trim(),
        description: form.description.trim(),
        start_now: form.start_now,
        scheduled_start: form.start_now ? null : new Date(form.when).toISOString(),
      })
      onCreated(lc)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }
  const field = 'w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white'
  return (
    <Modal open={open} onClose={onClose} title="New live class" maxWidth="max-w-lg">
      <div className="space-y-3">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Course
          <select value={form.course_id} onChange={(e) => set({ course_id: e.target.value })} className={`mt-1 ${field}`} data-testid="lc-course">
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Title
          <input value={form.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} placeholder="Week 5 — Graph algorithms" className={`mt-1 ${field}`} data-testid="lc-title" />
        </label>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Description (optional)
          <textarea rows={2} value={form.description} maxLength={5000} onChange={(e) => set({ description: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={form.start_now} onChange={(e) => set({ start_now: e.target.checked })} data-testid="lc-start-now" /> Start immediately
        </label>
        {!form.start_now && (
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Date and starting time
            <input type="datetime-local" value={form.when} onChange={(e) => set({ when: e.target.value })} className={`mt-1 ${field}`} />
            {whenError && <span className="mt-1 block text-[11px] font-medium text-rose-600" role="alert">{whenError}</span>}
          </label>
        )}
        {form.title && titleError && <p className="text-[11px] font-medium text-rose-600" role="alert">{titleError}</p>}
        <p className="text-xs text-slate-400">Every student enrolled in the course can join. Only enrolled students can use the link.</p>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !!titleError || !!whenError || !form.course_id} onClick={submit} icon={saving ? Loader2 : form.start_now ? Radio : Plus} data-testid="lc-create">
            {form.start_now ? 'Create & start' : 'Schedule class'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Attendance({ lc, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!lc) return
    setData(null)
    api.get(`/live-classes/${lc.id}/attendance`).then(setData).catch((e) => setError(e.message))
  }, [lc])
  return (
    <Modal open={!!lc} onClose={onClose} title={`Attendance — ${lc?.title || ''}`} maxWidth="max-w-2xl">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!data && !error && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
      {data && (
        <div className="space-y-3" data-testid="attendance">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <b>{data.present}</b> of {data.enrolled} enrolled students attended · class length {formatDuration(data.duration_seconds)}
          </p>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400"><tr><th className="py-1">Student</th><th>Status</th><th>Time in class</th><th>Joins</th><th>First joined</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.user_id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 font-medium text-slate-800 dark:text-slate-100">{r.name} <span className="text-slate-400">{r.student_code}</span></td>
                    <td>{r.connected ? <span className="font-semibold text-emerald-600">In class</span> : r.present ? <span className="text-emerald-600">Present</span> : <span className="text-rose-600">Absent</span>}</td>
                    <td className="tabular-nums">{formatDuration(r.total_seconds)}</td>
                    <td>{r.join_count}</td>
                    <td>{r.first_joined_at ? new Date(r.first_joined_at).toLocaleTimeString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function LiveClassesPage() {
  const { courses } = useExams()
  const navigate = useNavigate()
  const [classes, setClasses] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [attendanceFor, setAttendanceFor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)

  const load = useCallback(() => api.get('/live-classes/mine').then(setClasses).catch((e) => setError(e.message)), [])
  useEffect(() => {
    load()
  }, [load])

  const flash = (text) => {
    setToast(text)
    setTimeout(() => setToast(null), 2500)
  }
  const start = async (lc) => {
    setBusy(true)
    try {
      await api.post(`/live-classes/${lc.id}/start`)
      navigate(`/live/${lc.id}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const cancel = async (lc) => {
    if (!window.confirm(`Cancel "${lc.title}"?`)) return
    try {
      await api.delete(`/live-classes/${lc.id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }
  const copy = async (lc) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/live/join/${lc.meeting_code}`)
      flash('Joining link copied')
    } catch {
      flash(`Meeting code: ${lc.meeting_code}`)
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Live Classes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Teach your courses live with video, screen sharing, chat and attendance.</p>
        </div>
        <Button icon={Plus} onClick={() => setCreating(true)} disabled={!courses.length} data-testid="new-live-class">New live class</Button>
      </div>
      {!courses.length && <p className="text-sm text-slate-500">Create a course first — live classes belong to a course.</p>}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10" role="alert">{error}</p>}
      {toast && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10">{toast}</p>}
      {classes === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      ) : classes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-slate-700">No live classes yet.</p>
      ) : (
        <div className="space-y-2">
          {classes.map((lc) => (
            <LiveClassCard key={lc.id} lc={lc} isTeacher busy={busy} onStart={start} onCancel={cancel} onAttendance={setAttendanceFor} onCopy={copy} />
          ))}
        </div>
      )}
      <CreateLiveClass
        open={creating}
        onClose={() => setCreating(false)}
        courses={courses}
        onCreated={(lc) => {
          setCreating(false)
          if (lc.status === 'live') navigate(`/live/${lc.id}`)
          else load()
        }}
      />
      <Attendance lc={attendanceFor} onClose={() => setAttendanceFor(null)} />
    </main>
  )
}