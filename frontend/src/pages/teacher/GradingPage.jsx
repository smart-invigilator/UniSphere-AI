import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, Link, Navigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2, ShieldAlert, FileDown, Bot, PenLine, Save } from 'lucide-react'
import { api } from '../../services/api'
import { useNotify } from '../../context/NotifyContext'
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
  const notify = useNotify()
  const [searchParams] = useSearchParams()
  const initialAttemptId = searchParams.get('attempt') || null // opaque string reference, not a number
  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [attempts, setAttempts] = useState([])
  const [riskByAttempt, setRiskByAttempt] = useState({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState([])
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(false)
  const [onlyPending, setOnlyPending] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [downloadingReport, setDownloadingReport] = useState(false)

  const load = useCallback(async () => {
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

  useEffect(() => {
    if (!initialAttemptId || selected || attempts.length === 0) return
    const target = attempts.find((a) => a.id === initialAttemptId)
    if (target) openAttempt(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAttemptId, attempts])

  const applyAnswers = (ans) => {
    setAnswers(ans)
    const initial = {}
    ans.forEach((a) => { initial[a.question_id] = { marks: a.marks_awarded, feedback: a.feedback || '' } })
    setDrafts(initial)
  }

  const openAttempt = async (attempt) => {
    setSelected(attempt)
    setAnswers([])
    setDrafts({})
    try {
      applyAnswers(await api.get(`/attempts/${attempt.id}/answers`))
    } catch (err) {
      notify.error(err.message || 'Could not load answers for this submission.')
    }
  }

  const gradableQuestions = questions.filter((q) => isAnswerable(q.type))
  const answerByQuestion = Object.fromEntries(answers.map((a) => [a.question_id, a]))
  const manualCount = answers.filter((a) => a.requires_manual).length
  const pendingCount = answers.filter((a) => a.requires_manual && !a.graded).length
  const visibleQuestions = onlyPending
    ? gradableQuestions.filter((q) => answerByQuestion[q.id]?.requires_manual && !answerByQuestion[q.id]?.graded)
    : gradableQuestions

  const draftFor = (q) => {
    const ans = answerByQuestion[q.id]
    return drafts[q.id] || { marks: ans?.marks_awarded ?? 0, feedback: ans?.feedback ?? '' }
  }

  // A question needs saving when the teacher changed it, or it still awaits a manual grade
  // and they typed marks for it (including 0).
  const isDirty = (q) => {
    const ans = answerByQuestion[q.id]
    const d = drafts[q.id]
    if (!ans || !d) return false
    return Number(d.marks) !== Number(ans.marks_awarded) || (d.feedback || '') !== (ans.feedback || '')
  }
  const dirtyQuestions = useMemo(
    () => gradableQuestions.filter(isDirty),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gradableQuestions, drafts, answers]
  )
  const hasInvalid = dirtyQuestions.some((q) => gradeMarksError(draftFor(q).marks, q.marks))

  // Questions that need manual grading and have not been graded yet are included even when
  // the teacher left the default mark of 0, so "Save All" can finish grading the attempt.
  const saveAll = async () => {
    const toSave = gradableQuestions.filter((q) => {
      const ans = answerByQuestion[q.id]
      return isDirty(q) || (ans?.requires_manual && !ans?.graded)
    })
    if (toSave.length === 0) return
    for (const q of toSave) {
      const err = gradeMarksError(draftFor(q).marks, q.marks)
      if (err) {
        notify.error(`Q${q.order + 1}: ${err}`)
        return
      }
    }
    setSaving(true)
    try {
      await api.post(`/attempts/${selected.id}/grade`, {
        grades: toSave.map((q) => ({
          question_id: q.id,
          marks_awarded: Number(draftFor(q).marks),
          feedback: draftFor(q).feedback || '',
        })),
      })
      applyAnswers(await api.get(`/attempts/${selected.id}/answers`))
      await load()
      notify.success(`${toSave.length} grade${toSave.length === 1 ? '' : 's'} saved successfully.`)
    } catch (err) {
      notify.error(err.message || 'Could not save the grades.')
    } finally {
      setSaving(false)
    }
  }

  const selectedRisk = selected ? riskByAttempt[selected.id] : null
  const selectedIndex = selected ? attempts.findIndex((a) => a.id === selected.id) : -1
  const goTo = (offset) => {
    const next = attempts[selectedIndex + offset]
    if (next) openAttempt(next)
  }

  const downloadReport = async () => {
    if (!selected) return
    setDownloadingReport(true)
    try {
      const safeName = (selected.student_code || selected.student_name || 'student')
        .toString()
        .replace(/[^a-z0-9-_]+/gi, '_')
      await api.downloadFile(
        `/attempts/${selected.id}/report`,
        `exam-report-${safeName}-attempt-${selected.id}.pdf`,
      )
      notify.success('Report downloaded.')
    } catch (err) {
      notify.error(err?.message || 'Could not download the report.')
    } finally {
      setDownloadingReport(false)
    }
  }

  if (!initialAttemptId && exam) return <Navigate to={`/teacher/grading?course=${exam.course_id}`} replace />
  if (loading) return <main className="mx-auto max-w-[1000px] px-4 py-6"><p className="text-sm text-slate-400">Loading…</p></main>
  if (loadError) {
    return (
      <main className="mx-auto max-w-[1000px] px-4 py-6">
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{loadError}</p>
      </main>
    )
  }

  const pendingToSave = gradableQuestions.filter((q) => {
    const ans = answerByQuestion[q.id]
    return isDirty(q) || (ans?.requires_manual && !ans?.graded)
  }).length

  return (
    <main className="mx-auto max-w-[1000px] px-4 py-6 pb-28">
      <Link to={`/teacher/grading?course=${exam?.course_id ?? ''}`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to students
      </Link>
      <h1 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">{exam?.title} — Grading</h1>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
        Objective questions are auto-graded. Enter marks for any question — manual or auto-graded — then save everything with one button.
      </p>

      {attempts.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-slate-700">
          No submissions yet.
        </p>
      ) : (
        <>
          {/* Prev / next within this exam's submissions */}
          <div className="mt-5 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <Button size="sm" variant="outline" icon={ChevronLeft} disabled={selectedIndex <= 0} onClick={() => goTo(-1)}>Previous student</Button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {selectedIndex >= 0 ? `Submission ${selectedIndex + 1} of ${attempts.length}` : `${attempts.length} submissions`}
            </span>
            <Button size="sm" variant="outline" disabled={selectedIndex < 0 || selectedIndex >= attempts.length - 1} onClick={() => goTo(1)}>
              Next student <ChevronRight className="ml-1 inline h-3.5 w-3.5" />
            </Button>
          </div>

          {!selected && <p className="mt-6 text-center text-sm text-slate-400">Loading submission…</p>}

          {selected && (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3">
                  <Avatar name={selected.student_name || 'Student'} size="lg" />
                  <div>
                    <p className="text-base font-semibold text-slate-900 dark:text-white">{selected.student_name || 'Student'}</p>
                    {selected.student_email && <p className="text-xs text-slate-400">{selected.student_email}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedRisk && <Badge color={RISK_BADGE_COLOR[selectedRisk.risk_level]}>{RISK_LABEL[selectedRisk.risk_level]}</Badge>}
                  <Button size="sm" variant="outline" icon={FileDown} disabled={downloadingReport} onClick={downloadReport}>
                    {downloadingReport ? 'Preparing…' : 'Report (PDF)'}
                  </Button>
                </div>
              </div>

              {/* Scores + integrity */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Auto score" value={selected.auto_score} />
                <Stat label="Manual score" value={selected.manual_score} />
                <Stat label="Final" value={`${selected.final_score ?? '—'} / ${exam?.total_marks}`} accent />
                {selectedRisk ? (
                  <Stat
                    label={<span className="inline-flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> Alerts L/M/H</span>}
                    value={`${selectedRisk.alert_counts.low} / ${selectedRisk.alert_counts.medium} / ${selectedRisk.alert_counts.high}`}
                  />
                ) : <Stat label="Alerts" value="—" />}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className={pendingCount ? 'font-semibold text-amber-600' : 'text-emerald-600'}>
                  {pendingCount ? `${pendingCount} of ${manualCount} awaiting grading` : 'All answers graded'}
                </span>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-slate-500">
                  <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600" />
                  Needs grading only
                </label>
              </div>


              {/* Questions */}
              {visibleQuestions.map((q) => {
                const ans = answerByQuestion[q.id]
                const d = draftFor(q)
                const manual = !!ans?.requires_manual
                const err = gradeMarksError(d.marks, q.marks)
                const status = manual
                  ? ans?.graded ? { label: 'Manually graded', color: 'emerald' } : { label: 'Needs grading', color: 'amber' }
                  : ans?.graded ? { label: 'Score overridden', color: 'brand' } : { label: ans?.is_correct ? 'Auto · correct' : ans?.marks_awarded > 0 ? 'Auto · partial' : 'Auto · incorrect', color: ans?.is_correct ? 'emerald' : 'rose' }
                return (
                  <section key={q.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/40">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                        Q{q.order + 1} · {typeLabel(q.type)} · {q.marks} marks
                      </p>
                      <span className="flex items-center gap-1.5">
                        {manual ? <PenLine className="h-3.5 w-3.5 text-slate-400" /> : <Bot className="h-3.5 w-3.5 text-slate-400" />}
                        <Badge color={status.color}>{status.label}</Badge>
                        {ans && <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{ans.marks_awarded}/{q.marks}</span>}
                      </span>
                    </header>
                    <div className="space-y-3 p-4">
                      <MathText text={q.text} className="text-sm font-medium text-slate-900 dark:text-white" />
                      {q.type !== 'hotspot' && <QuestionMediaView media={q.media} />}
                      {q.settings?.rich_content && (
                        <AnswerDocumentView response={q.settings.rich_content} ariaLabel="Question content" testId="question-content-doc" />
                      )}
                      <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Student's answer</p>
                        <ResponseView question={q} response={ans?.response} />
                      </div>
                      <div className="flex flex-wrap items-start gap-3">
                        <label className="text-xs">
                          <span className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">Marks (/{q.marks})</span>
                          <input
                            type="number" min={0} max={q.marks} step="0.5" value={d.marks}
                            aria-invalid={!!err}
                            aria-describedby={`marks-error-${q.id}`}
                            onChange={(e) => setDrafts((st) => ({ ...st, [q.id]: { ...d, marks: e.target.value } }))}
                            className={`input w-24 ${err ? 'border-rose-400 ring-1 ring-rose-300' : ''}`}
                          />
                          {err && (
                            <span id={`marks-error-${q.id}`} role="alert" className="mt-1 block text-[11px] font-medium text-rose-600">{err}</span>
                          )}
                        </label>
                        <label className="min-w-[200px] flex-1 text-xs">
                          <span className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">Feedback (optional)</span>
                          <input
                            value={d.feedback}
                            maxLength={5000}
                            onChange={(e) => setDrafts((st) => ({ ...st, [q.id]: { ...d, feedback: e.target.value } }))}
                            className="input"
                          />
                        </label>
                      </div>
                    </div>
                  </section>
                )
              })}
              {visibleQuestions.length === 0 && (
                <p className="text-sm text-slate-400">{onlyPending ? 'Nothing left to grade for this submission.' : 'This exam has no gradable questions.'}</p>
              )}
            </div>
          )}

          {/* Single save button for the whole submission */}
          {selected && (
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
              <div className="mx-auto flex max-w-[1000px] items-center justify-between gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {dirtyQuestions.length > 0
                    ? `${dirtyQuestions.length} unsaved change${dirtyQuestions.length === 1 ? '' : 's'}`
                    : pendingCount > 0 ? `${pendingCount} question${pendingCount === 1 ? '' : 's'} still need a grade` : 'No unsaved changes'}
                </span>
                <Button icon={saving ? undefined : (pendingToSave ? Save : CheckCircle2)} disabled={saving || hasInvalid || pendingToSave === 0} onClick={saveAll}>
                  {saving ? 'Saving…' : 'Save All Grades'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${accent ? 'border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
      <p className="text-base font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  )
}
