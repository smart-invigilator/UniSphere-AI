import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ShieldAlert, FileDown } from 'lucide-react'
import { api } from '../../services/api'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'
import Avatar from '../../components/Avatar'
import MathText from '../../components/math/MathText'
import AnswerView from '../../components/questions/AnswerView'
import { isManualType, typeLabel } from '../../utils/questionTypes'

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
  const [loadingAnswers, setLoadingAnswers] = useState(false)
  const [saving, setSaving] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(null)

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
    setAnswers([])
    setDrafts({})
    setLoadingAnswers(true)
    setSaveError(null)
    setSaveSuccess(null)
    try {
      const ans = await api.get(`/attempts/${attempt.id}/answers`)
      setAnswers(ans)
      const initialDrafts = {}
      ans.forEach((a) => { initialDrafts[a.question_id] = { marks: a.marks_awarded, feedback: a.feedback } })
      setDrafts(initialDrafts)
    } catch (err) {
      setSaveError(err.message || 'Could not load this student’s answers.')
    } finally {
      setLoadingAnswers(false)
    }
  }

  const manualQuestions = questions.filter((q) => isManualType(q.type))
  const autoQuestions = questions.filter((q) => !isManualType(q.type))

  const saveGrade = async () => {
    if (!selected) return
    setSaveError(null)
    setSaveSuccess(null)
    const grades = []
    for (const q of questions) {
      const d = drafts[q.id] || { marks: '', feedback: '' }
      const rawMarks = String(d.marks ?? '').trim()
      const marks = rawMarks === '' ? NaN : Number(rawMarks)
      if (!Number.isFinite(marks) || marks < 0 || marks > q.marks) {
        setSaveError(`Enter marks from 0 to ${q.marks} for question ${q.order + 1}.`)
        return
      }
      grades.push({
        question_id: q.id,
        marks_awarded: marks,
        feedback: d.feedback || '',
      })
    }

    setSaving(true)
    let gradesSaved = false
    try {
      const updatedAttempt = await api.post(`/attempts/${selected.id}/grade`, {
        grades,
      })
      gradesSaved = true
      setSaveSuccess('Grades saved successfully.')
      const ans = await api.get(`/attempts/${selected.id}/answers`)
      setAnswers(ans)
      const updatedDrafts = {}
      ans.forEach((a) => { updatedDrafts[a.question_id] = { marks: a.marks_awarded, feedback: a.feedback } })
      setDrafts(updatedDrafts)
      const updatedScores = {
        status: updatedAttempt.status,
        auto_score: updatedAttempt.auto_score,
        manual_score: updatedAttempt.manual_score,
        final_score: updatedAttempt.final_score,
      }
      setSelected((current) => current ? { ...current, ...updatedScores } : current)
      setAttempts((current) => current.map((attempt) =>
        attempt.id === updatedAttempt.id ? { ...attempt, ...updatedScores } : attempt,
      ))
    } catch (err) {
      setSaveError(gradesSaved
        ? `Grades were saved, but the updated answers could not be reloaded: ${err.message || 'Refresh the page to see them.'}`
        : err.message || 'Could not save grades.')
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
      const studentName = (selected.student_name || selected.student_code || 'student')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      await api.downloadFile(
        `/attempts/${selected.id}/report`,
        `exam-report-${studentName || 'student'}-attempt-${selected.attempt_number || 1}.pdf`,
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

  const renderCard = (q, auto) => {
    const ans = answers.find((a) => a.question_id === q.id)
    const d = drafts[q.id] || { marks: 0, feedback: '' }
    const markValue = String(d.marks ?? '').trim()
    const markNumber = markValue === '' ? NaN : Number(markValue)
    const invalidMarks = !Number.isFinite(markNumber) || markNumber < 0 || markNumber > q.marks
    return (
      <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-600">
          <span>Q{q.order + 1} · {typeLabel(q.type)} · {q.marks} marks</span>
          {auto && ans && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${ans.marks_awarded >= q.marks ? 'bg-emerald-100 text-emerald-700' : ans.marks_awarded > 0 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
              auto: {ans.marks_awarded}/{q.marks}
            </span>
          )}
        </p>
        <MathText as="p" text={q.text} className="mt-1 text-sm font-medium text-slate-900 dark:text-white" />
        <div className="mt-2"><AnswerView question={q} response={ans?.response} showKey={auto} /></div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">Marks (/{q.marks})</span>
            <input
              type="number" min={0} max={q.marks} step="any" value={d.marks}
              onChange={(e) => {
                setSaveSuccess(null)
                setDrafts((st) => ({ ...st, [q.id]: { ...d, marks: e.target.value } }))
              }}
              aria-invalid={invalidMarks}
              className={`input w-20 ${invalidMarks ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500' : ''}`}
            />
          </label>
          <label className="flex-1 text-xs">
            <span className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">Feedback (optional)</span>
            <input
              value={d.feedback}
              onChange={(e) => {
                setSaveSuccess(null)
                setDrafts((st) => ({ ...st, [q.id]: { ...d, feedback: e.target.value } }))
              }}
              className="input"
            />
          </label>
        </div>
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6">
      <Link to="/teacher/exams" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> All exams
      </Link>
      <h1 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{exam?.title} — Grading</h1>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
        {manualQuestions.length} written question(s) need your marks. Every other question type is graded automatically — you can still review and override those.
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
                      {a.student_name || `Student ${a.student_id}`}
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
                    {selected.student_name || `Student ${selected.student_id}`}
                  </p>
                  <p className="text-xs text-slate-400">
                    {selected.student_code} {selected.student_email ? `· ${selected.student_email}` : ''} · Attempt #{selected.attempt_number || 1}
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

              {manualQuestions.map((q) => renderCard(q, false))}
              {manualQuestions.length === 0 && (
                <p className="text-sm text-slate-400">This exam has no written questions — grading is fully automatic.</p>
              )}
              {autoQuestions.length > 0 && (
                <details className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Auto-graded questions ({autoQuestions.length}) — review and adjust marks
                  </summary>
                  <div className="mt-3 space-y-3">{autoQuestions.map((q) => renderCard(q, true))}</div>
                </details>
              )}
              {saveError && (
                <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
                  {saveError}
                </p>
              )}
              {saveSuccess && (
                <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                  {saveSuccess}
                </p>
              )}
              <div className="flex justify-end border-t border-slate-200 pt-4 dark:border-slate-800">
                <Button icon={CheckCircle2} disabled={saving || loadingAnswers} onClick={saveGrade}>
                  {loadingAnswers ? 'Loading Answers…' : saving ? 'Saving Grades…' : 'Save Grade'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}