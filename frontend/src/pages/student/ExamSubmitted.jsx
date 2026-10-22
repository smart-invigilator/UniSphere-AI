import { useLocation, Link } from 'react-router-dom'
import { CheckCircle2, Award, ListChecks, ArrowRight } from 'lucide-react'
import Button from '../../components/common/Button'

export default function ExamSubmitted() {
  const { state } = useLocation()
  const answered = state?.answered ?? 0
  const total = state?.total ?? 0
  const autoScore = state?.autoScore
  const totalMarks = state?.totalMarks
  const ungraded = state?.ungraded ?? 0

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
          <CheckCircle2 className="h-8 w-8" />
        </span>
        <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">Exam Submitted</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {state?.examTitle ? `Your responses for "${state.examTitle}" have been recorded.` : 'Your responses have been recorded.'}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <ListChecks className="mx-auto h-4 w-4 text-brand-600" />
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{answered}/{total}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Questions Answered</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <Award className="mx-auto h-4 w-4 text-brand-600" />
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              {autoScore != null ? `${autoScore}${totalMarks != null ? `/${totalMarks}` : ''}` : '—'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Auto-graded Score</p>
          </div>
        </div>

        {ungraded > 0 && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            {ungraded} written question{ungraded > 1 ? "s" : ""} still need manual grading by your instructor — your final score will update once that's done.
          </p>
        )}


        <Button as={Link} to="/student/dashboard" className="mt-3 w-full" iconRight={ArrowRight}>Back to Dashboard</Button>
      </div>
    </div>
  )
}