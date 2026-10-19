import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ShieldAlert, FileDown } from 'lucide-react'
import { api } from '../../services/api'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'
import Avatar from '../../components/Avatar'

const RISK_BADGE_COLOR = { low: 'emerald', medium: 'amber', high: 'rose' }
const RISK_LABEL = { low: 'Low Risk', medium: 'Medium Risk', high: 'High Risk' }

export default function GradingPage() {
  const { examId } = useParams()
  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [attempts, setAttempts] = useState([])
  const [riskByAttempt, setRiskByAttempt] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState([])
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(null)

  const [loadError, setLoadError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [e, qs, atts, risks] = await Promise.all([
        api.get(`/exams/${examId}`),
        api.get(`/exams/${examId}/questions`),
        api.get(`/attempts/exam/${examId}`),
        api.get(`/attempts/exam/${examId}/risk`).catch(() => []),
      ])
      setExam(e)
      setQuestions(qs)
      setAttempts(atts.filter((a) => a.status === 'submitted' || a.status === 'graded'))
      setRiskByAttempt(Object.fromEntries(risks.map((r) => [r.attempt_id, r])))
    } catch (err) {
      setLoadError(err.message || 'Could not load submissions for this exam.')
    } finally {
      setLoading(false)
    }
  }, [examId])

  useEffect(() => { load() }, [load])

  const openAttempt = async (attempt) => {
    setSelected(attempt)
    const ans = await api.get(`/attempts/${attempt.id}/answers`)
    setAnswers(ans)
    const initialDrafts = {}
    ans.forEach((a) => { initialDrafts[a.question_id] = { marks: a.marks_awarded, feedback: a.feedback } })
    setDrafts(initialDrafts)
  }

  const saveGrade = async (questionId) => {
    const d = drafts[questionId] || { marks: 0, feedback: '' }
    const question = questions.find((item) => item.id === questionId)
    const marks = Number(d.marks)
    if (!question || !Number.isFinite(marks) || marks < 0 || marks > question.marks) return

    setSaving(questionId)
    try {
      await api.post(`/attempts/${selected.id}/grade/${questionId}`, {
        marks_awarded: marks,
        feedback: d.feedback || '',
      })
      const ans = await api.get(`/attempts/${selected.id}/answers`)
      setAnswers(ans)
      await load()
    } finally {
      setSaving(null)
    }
  }

  const selectedRisk = selected ? riskByAttempt[selected.id] : null
  const [downloadingReport, setDownloadingReport] = useState(false)

  const downloadReport = async () => {
    if (!selected) return
    setDownloadingReport(true)
    try {
      const studentName = (selected.student_name || `student-${selected.student_id}`)
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/[. ]+$/g, '') || `student-${selected.student_id}`
      await api.downloadFile(
        `/attempts/${selected.id}/report`,
        `exam-report-${studentName}-attempt-${selected.id}.pdf`,
      )
    } finally {
      setDownloadingReport(false)
    }
  }

  if (loading) return <main className="mx-auto max-w-[1200px] px-4 py-6"><p className="text-sm text-slate-400">Loading…</p></main>
  if (loadError) {
    return (
      <main className="mx-auto max-w-[1200px] px-4 py-6">
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{loadError}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6">
      <Link to="/teacher/exams" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> All exams
      </Link>
      <h1 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{exam?.title} — Grading</h1>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
        Short-answer questions need manual grading. You can also adjust marks on any question, including auto-graded MCQ and True/False.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-1.5">
          {attempts.map((a) => {
            const risk = riskByAttempt[a.id]
            return (
              <button
                key={a.id}
                onClick={() => openAttempt(a)}
                className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-sm ${
                  selected?.id === a.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={a.student_name || `Student ${a.student_id}`} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">
                      {a.student_name || `Attempt #${a.id}`}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-slate-400">{a.student_code || `#${a.id}`}</span>
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {risk && risk.risk_level !== 'low' && (
                    <Badge color={RISK_BADGE_COLOR[risk.risk_level]}>{RISK_LABEL[risk.risk_level]}</Badge>
                  )}
                  <Badge color={a.status === 'graded' ? 'emerald' : 'amber'}>{a.status}</Badge>
                </span>
              </button>
            )
          })}
          {attempts.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
              No submissions yet.
            </p>
          )}
        </div>

        <div>
          {!selected && <p className="text-sm text-slate-400">Select a submission to grade.</p>}
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {selected.student_name || `Attempt #${selected.id}`}
                  </p>
                  <p className="text-xs text-slate-400">
                    {selected.student_code} {selected.student_email ? `· ${selected.student_email}` : ''} · Attempt #{selected.id}
                  </p>
                </div>
                <Button size="sm" variant="outline" icon={FileDown} disabled={downloadingReport} onClick={downloadReport}>
                  {downloadingReport ? 'Preparing…' : 'Download Report (PDF)'}
                </Button>
              </div>

              {selectedRisk && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <ShieldAlert className="h-3.5 w-3.5" /> Integrity Summary
                    </p>
                    <Badge color={RISK_BADGE_COLOR[selectedRisk.risk_level]}>{RISK_LABEL[selectedRisk.risk_level]}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                      <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{selectedRisk.suspicion_score}</p>
                      <p className="text-slate-500 dark:text-slate-400">Suspicion Score</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-500/10">
                      <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{selectedRisk.alert_counts.low}</p>
                      <p className="text-emerald-600 dark:text-emerald-400">Low</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-2 dark:bg-amber-500/10">
                      <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{selectedRisk.alert_counts.medium}</p>
                      <p className="text-amber-600 dark:text-amber-400">Medium</p>
                    </div>
                    <div className="rounded-lg bg-rose-50 p-2 dark:bg-rose-500/10">
                      <p className="text-lg font-bold text-rose-700 dark:text-rose-400">{selectedRisk.alert_counts.high}</p>
                      <p className="text-rose-600 dark:text-rose-400">High</p>
                    </div>
                  </div>
                </div>
              )}

              {questions.map((q) => {
                const ans = answers.find((a) => a.question_id === q.id)
                const d = drafts[q.id] || { marks: 0, feedback: '' }
                const marks = Number(d.marks)
                const invalidMarks = d.marks === '' || !Number.isFinite(marks) || marks < 0 || marks > q.marks
                const typeLabel = q.type === 'short'
                  ? 'Short Answer'
                  : q.type === 'mcq'
                    ? 'Multiple Choice'
                    : 'True / False'
                return (
                  <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Q{q.order + 1} · {typeLabel} · {q.marks} marks</p>
                    <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{q.text}</p>
                    <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {ans?.response || <span className="italic text-slate-400">No answer submitted</span>}
                    </div>
                    {q.type !== 'short' && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span>
                          Auto-graded: {ans?.is_correct
                            ? `Correct (${q.marks}/${q.marks} marks)`
                            : `Incorrect (0/${q.marks} marks)`}
                        </span>
                        <span>Correct answer: {q.correct_answer || 'Not set'}</span>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="text-xs">
                        <span className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">Marks (/{q.marks})</span>
                        <input
                          type="number" min={0} max={q.marks} step="any" value={d.marks}
                          aria-invalid={invalidMarks}
                          onChange={(e) => setDrafts((s) => ({ ...s, [q.id]: { ...d, marks: e.target.value } }))}
                          className={`input w-20 ${invalidMarks ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500' : ''}`}
                        />
                        {invalidMarks && (
                          <span className="mt-1 block text-rose-600 dark:text-rose-400" role="alert">
                            Enter a value from 0 to {q.marks}.
                          </span>
                        )}
                      </label>
                      <label className="flex-1 text-xs">
                        <span className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">Feedback (optional)</span>
                        <input
                          value={d.feedback}
                          onChange={(e) => setDrafts((s) => ({ ...s, [q.id]: { ...d, feedback: e.target.value } }))}
                          className="input"
                        />
                      </label>
                      <Button size="sm" icon={CheckCircle2} disabled={saving === q.id || invalidMarks} onClick={() => saveGrade(q.id)}>
                        {saving === q.id ? 'Saving…' : 'Save Grade'}
                      </Button>
                    </div>
                  </div>
                )
              })}
              {questions.length === 0 && (
                <p className="text-sm text-slate-400">This exam has no questions to grade.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}