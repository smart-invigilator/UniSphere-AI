import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ShieldAlert, FileDown, Bot, PenLine } from 'lucide-react'
import { api } from '../../services/api'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'
import Avatar from '../../components/Avatar'
import MathText from '../../components/math/MathText'
import ResponseView from '../../components/questions/ResponseView'
import { QuestionMediaView } from '../../components/questions/QuestionMedia'
import { isAnswerable, typeLabel, gradeMarksError } from '../../components/questions/questionTypes'
import AnswerDocumentView from '../../components/answer-editor/AnswerDocumentView'

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
  const [onlyPending, setOnlyPending] = useState(false)
  const [answersError, setAnswersError] = useState(null)

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
      const done = atts.filter((a) => a.status === 'submitted' || a.status === 'graded')
      setAttempts(done)
      setSelected((prev) => (prev ? done.find((a) => a.id === prev.id) || prev : prev))
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
    setReportError(null)
    setAnswersError(null)
    setAnswers([])
    try {
      const ans = await api.get(`/attempts/${attempt.id}/answers`)
      setAnswers(ans)
      const initialDrafts = {}
      ans.forEach((a) => { initialDrafts[a.question_id] = { marks: a.marks_awarded, feedback: a.feedback } })
      setDrafts(initialDrafts)
    } catch (err) {
      setAnswersError(err.message || 'Could not load answers for this submission.')
    }
  }

  const gradableQuestions = questions.filter((q) => isAnswerable(q.type))
  const answerByQuestion = Object.fromEntries(answers.map((a) => [a.question_id, a]))
  const manualCount = (attemptAnswers) => attemptAnswers.filter((a) => a.requires_manual).length
  const pendingCount = answers.filter((a) => a.requires_manual && !a.graded).length
  const visibleQuestions = onlyPending
    ? gradableQuestions.filter((q) => answerByQuestion[q.id]?.requires_manual && !answerByQuestion[q.id]?.graded)
    : gradableQuestions

  const saveGrade = async (questionId, maxMarks) => {
    const d = drafts[questionId] || { marks: 0, feedback: '' }
    const invalid = gradeMarksError(d.marks, maxMarks)
    if (invalid) {
      setAnswersError(invalid)
      return
    }
    setSaving(questionId)
    setAnswersError(null)
    try {
      await api.post(`/attempts/${selected.id}/grade/${questionId}`, {
        marks_awarded: Number(d.marks),
        feedback: d.feedback || '',
      })
      const ans = await api.get(`/attempts/${selected.id}/answers`)
      setAnswers(ans)
      await load()
    } catch (err) {
      setAnswersError(err.message || 'Could not save the grade.')
    } finally {
      setSaving(null)
    }
  }

  const selectedRisk = selected ? riskByAttempt[selected.id] : null
  const [downloadingReport, setDownloadingReport] = useState(false)
  const [reportError, setReportError] = useState(null)

  const downloadReport = async () => {
    if (!selected) return
    setDownloadingReport(true)
    setReportError(null)
    try {
      const safeName = (selected.student_code || selected.student_name || 'student')
        .toString()
        .replace(/[^a-z0-9-_]+/gi, '_')
      await api.downloadFile(
        `/attempts/${selected.id}/report`,
        `exam-report-${safeName}-attempt-${selected.id}.pdf`,
      )
    } catch (err) {
      setReportError(err?.message || 'Could not download the report.')
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
        Objective questions are auto-graded. Short answer, essay, file upload and unverifiable math answers need manual grading — you can also override any auto-graded score.
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
              {reportError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
                  {reportError}
                </p>
              )}

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

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-900">
                <span className="text-slate-600 dark:text-slate-300">
                  Auto score <b>{selected.auto_score}</b> · Manual score <b>{selected.manual_score}</b> · Final{' '}
                  <b>{selected.final_score ?? '—'}</b> / {exam?.total_marks}
                </span>
                <span className="flex items-center gap-3">
                  <span className={pendingCount ? 'font-semibold text-amber-600' : 'text-emerald-600'}>
                    {pendingCount ? `${pendingCount} of ${manualCount(answers)} awaiting grading` : 'All answers graded'}
                  </span>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-slate-500">
                    <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600" />
                    Needs grading only
                  </label>
                </span>
              </div>
              {answersError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{answersError}</p>
              )}

              {visibleQuestions.map((q) => {
                const ans = answerByQuestion[q.id]
                const d = drafts[q.id] || { marks: ans?.marks_awarded ?? 0, feedback: ans?.feedback ?? '' }
                const manual = !!ans?.requires_manual
                const status = manual
                  ? ans?.graded ? { label: 'Manually graded', color: 'emerald' } : { label: 'Needs grading', color: 'amber' }
                  : ans?.graded ? { label: 'Score overridden', color: 'brand' } : { label: ans?.is_correct ? 'Auto · correct' : ans?.marks_awarded > 0 ? 'Auto · partial' : 'Auto · incorrect', color: ans?.is_correct ? 'emerald' : 'rose' }
                return (
                  <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                        Q{q.order + 1} · {typeLabel(q.type)} · {q.marks} marks
                      </p>
                      <span className="flex items-center gap-1.5">
                        {manual ? <PenLine className="h-3.5 w-3.5 text-slate-400" /> : <Bot className="h-3.5 w-3.5 text-slate-400" />}
                        <Badge color={status.color}>{status.label}</Badge>
                        {ans && <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{ans.marks_awarded}/{q.marks}</span>}
                      </span>
                    </div>
                    <MathText text={q.text} className="mt-1 text-sm font-medium text-slate-900 dark:text-white" />
                    {q.type !== 'hotspot' && <QuestionMediaView media={q.media} className="mt-2" />}
                    {q.settings?.rich_content && (
                      <div className="mt-2">
                        <AnswerDocumentView response={q.settings.rich_content} ariaLabel="Question content" testId="question-content-doc" />
                      </div>
                    )}
                    <div className="mt-2">
                      <ResponseView question={q} response={ans?.response} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="text-xs">
                        <span className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">Marks (/{q.marks})</span>
                        <input
                          type="number" min={0} max={q.marks} step="0.5" value={d.marks}
                          aria-invalid={!!gradeMarksError(d.marks, q.marks)}
                          aria-describedby={`marks-error-${q.id}`}
                          onChange={(e) => setDrafts((st) => ({ ...st, [q.id]: { ...d, marks: e.target.value } }))}
                          className={`input w-20 ${gradeMarksError(d.marks, q.marks) ? 'border-rose-400 ring-1 ring-rose-300' : ''}`}
                        />
                        {gradeMarksError(d.marks, q.marks) && (
                          <span id={`marks-error-${q.id}`} role="alert" className="mt-1 block text-[11px] font-medium text-rose-600">
                            {gradeMarksError(d.marks, q.marks)}
                          </span>
                        )}
                      </label>
                      <label className="flex-1 text-xs">
                        <span className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">Feedback (optional)</span>
                        <input
                          value={d.feedback}
                          maxLength={5000}
                          onChange={(e) => setDrafts((st) => ({ ...st, [q.id]: { ...d, feedback: e.target.value } }))}
                          className="input"
                        />
                      </label>
                      <Button size="sm" variant={manual ? 'primary' : 'outline'} icon={CheckCircle2} disabled={saving === q.id || !!gradeMarksError(d.marks, q.marks)} onClick={() => saveGrade(q.id, q.marks)}>
                        {saving === q.id ? 'Saving…' : manual ? 'Save Grade' : 'Override Score'}
                      </Button>
                    </div>
                  </div>
                )
              })}
              {visibleQuestions.length === 0 && (
                <p className="text-sm text-slate-400">{onlyPending ? 'Nothing left to grade for this submission.' : 'This exam has no gradable questions.'}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}