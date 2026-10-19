import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Radio, Users, Activity, BellRing, Plus, ArrowRight, Radar } from 'lucide-react'
import { useExams } from '../../context/ExamContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../services/api'
import { STATUS_META } from '../../data/examData'
import StatCard from '../../components/StatCard'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'

export default function TeacherDashboard() {
  const { exams, courses } = useExams()
  const { user } = useAuth()
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    api.get('/analytics/summary').then(setSummary).catch(() => {})
  }, [])

  const activeExams = exams.filter((e) => e.status === 'active' || e.status === 'published')
  const totalStudents = courses.reduce((sum, c) => sum + c.student_count, 0)

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Welcome back, {user?.name}</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Here's an overview of your courses, exams, and candidates.</p>
        </div>
        <Button as={Link} to="/teacher/create-exam" icon={Plus}>Create Exam</Button>
      </div>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={FileText} label="Total Exams" value={exams.length} accent="brand" />
        <StatCard icon={Radio} label="Open Exams" value={activeExams.length} accent="emerald" pulse={activeExams.length > 0} />
        <StatCard icon={Users} label="Total Students" value={totalStudents} accent="brand" />
        <StatCard icon={Activity} label="Live Now" value={summary?.activeStudents ?? '—'} accent="amber" />
        <StatCard icon={BellRing} label="Total Alerts" value={summary?.totalAlerts ?? '—'} accent="rose" />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent Exams</h2>
            <Link to="/teacher/exams" className="text-xs font-semibold text-brand-600 hover:underline">View all</Link>
          </div>
          <div className="mt-3 space-y-2">
            {exams.slice(0, 5).map((exam) => (
              <div key={exam.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{exam.title}</p>
                  <p className="text-xs text-slate-400">{exam.course_title}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={exam.is_closed ? STATUS_META.closed.color : (STATUS_META[exam.status]?.color || 'slate')}>
                    {exam.is_closed ? STATUS_META.closed.label : (STATUS_META[exam.status]?.label || exam.status)}
                  </Badge>
                  {(exam.status === 'active' || exam.status === 'published') && !exam.is_closed ? (
                    <Button as={Link} to={`/teacher/monitoring/${exam.id}`} size="sm" icon={Radar}>Monitor</Button>
                  ) : (
                    <Button as={Link} to="/teacher/exams" size="sm" variant="outline" iconRight={ArrowRight}>View</Button>
                  )}
                </div>
              </div>
            ))}
            {exams.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
                No exams yet. <Link to="/teacher/create-exam" className="text-brand-600 hover:underline">Create one</Link>.
              </p>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Your Courses</h2>
          <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            {courses.length === 0 && <p className="p-2 text-xs text-slate-400">No courses yet.</p>}
            {courses.slice(0, 6).map((c) => (
              <Link key={c.id} to={`/teacher/courses/${c.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                <span className="font-medium text-slate-700 dark:text-slate-200">{c.title}</span>
                <span className="text-slate-400">{c.student_count} students</span>
              </Link>
            ))}
            <Link to="/teacher/courses" className="mt-1 flex items-center justify-center gap-1 rounded-lg bg-slate-50 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700">
              View all courses <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}