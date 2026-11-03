import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, ListChecks, Loader2 } from 'lucide-react'
import { api } from '../../services/api'
import Button from '../../components/common/Button'
import MathText from '../../components/math/MathText'
import ResponseView from '../../components/questions/ResponseView'
import { QuestionMediaView } from '../../components/questions/QuestionMedia'
import { typeLabel } from '../../components/questions/questionTypes'

const formatScore = (value) => {
  if (value == null) return '—'
  return Number.isInteger(value) ? value : Number(value).toFixed(2).replace(/\.?0+$/, '')
}

export default function StudentExamResults() {
  const { attemptId } = useParams()
  const [attempt, setAttempt] = useState(null)
  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const currentAttempt = await api.get(`/attempts/${attemptId}`)
        const [currentExam, currentQuestions, currentAnswers] = await Promise.all([
          api.get(`/exams/${currentAttempt.exam_id}`),
          api.get(`/attempts/${attemptId}/questions`),
          api.get(`/attempts/${attemptId}/answers`),
        ])
        if (cancelled) return
        setAttempt(currentAttempt)
        setExam(currentExam)
        setQuestions(currentQuestions)
        setAnswers(currentAnswers)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load your exam results.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [attemptId])

  const answersByQuestion = useMemo(
    () => new Map(answers.map((answer) => [answer.question_id, answer])),
    [answers],
  )

  if (loading) {
    return (
      <main className="mx-auto flex max-w-[1000px] justify-center px-4 py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-label="Loading results" />
      </main>
    )
  }

  if (error || !attempt || !exam) {
    return (
      <main className="mx-auto max-w-[1000px] px-4 py-10">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertCircle className="mr-2 inline h-4 w-4" />{error || 'Results not found.'}
        </div>
        <Button as={Link} to="/student/dashboard" className="mt-4" icon={ArrowLeft}>Back to Dashboard</Button>
      </main>
    )
  }

  const score = attempt.final_score ?? (attempt.auto_score + attempt.manual_score)
  const pending = attempt.status === 'submitted'

  return (
    <main className="mx-auto max-w-[1000px] px-4 py-6">
      <Button as={Link} to="/student/dashboard" variant="ghost" size="sm" icon={ArrowLeft}>Back to Dashboard</Button>

      <header className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{exam.course_title}</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{exam.title}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Submitted {attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 px-5 py-3 text-center dark:bg-emerald-500/10">
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{formatScore(score)} / {exam.total_marks}</p>
            <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">{attempt.final_score == null ? 'Score so far' : 'Final score'}</p>
          </div>
        </div>
        {pending && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            Some answers are awaiting teacher grading. Your score will update when grading is complete.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5"><ListChecks className="h-4 w-4" /> {questions.length} questions</span>
          <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> Auto-graded: {formatScore(attempt.auto_score)}</span>
          <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> Manual: {formatScore(attempt.manual_score)}</span>
        </div>
      </header>

      <section className="mt-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Question-by-question results</h2>
        {questions.map((question, index) => {
          const answer = answersByQuestion.get(question.id)
          const marked = answer && (!answer.requires_manual || answer.graded)
          return (
            <article key={question.id} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-400">{index + 1}</span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{typeLabel(question.type)}</p>
                    <MathText text={question.text} className="mt-1 text-sm font-medium text-slate-900 dark:text-white" />
                    <QuestionMediaView media={question.media} className="mt-3" />
                  </div>
                </div>
                <div className={`shrink-0 rounded-lg px-3 py-2 text-right text-xs ${marked ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                  <p className="font-semibold">{marked ? `${formatScore(answer.marks_awarded)} / ${question.marks}` : 'Not marked'}</p>
                  {!marked && <p className="mt-0.5">Maximum: {question.marks}</p>}
                </div>
              </div>
              <div className="mt-4">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Your answer</p>
                <ResponseView question={question} response={answer?.response} />
              </div>
              {marked && answer.feedback && (
                <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                  <span className="font-semibold">Teacher feedback:</span> {answer.feedback}
                </p>
              )}
            </article>
          )
        })}
      </section>
    </main>
  )
}
