import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Clock, Users, Flag } from 'lucide-react'
import { useMonitor } from '../../context/MonitorContext'
import { useExams } from '../../context/ExamContext'
import { useFilteredStudents } from '../../hooks/useFilteredStudents'
import StatCard from '../../components/StatCard'
import Charts from '../../components/Charts'
import SearchFilterBar from '../../components/SearchFilterBar'
import StudentCard from '../../components/StudentCard'
import AlertPanel from '../../components/AlertPanel'
import StudentDetailModal from '../../components/StudentDetailModal'
import { CardSkeleton, StatSkeleton } from '../../components/Skeleton'
import { Users as UsersIcon, UserCheck, AlertTriangle, BellRing, Gauge, ShieldCheck } from 'lucide-react'

export default function LiveMonitoring() {
  const { examId } = useParams()
  const { exams } = useExams()
  const exam = exams.find((e) => String(e.id) === String(examId))
  const { students, alerts, loading, frames, connectExam, disconnectExam } = useMonitor()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('alerts-desc')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!exam || exam.is_closed) return
    connectExam(examId)
    return () => disconnectExam()
  }, [examId, exam])

  const filtered = useFilteredStudents(students, { query, filter, sort })

  const stats = useMemo(() => {
    const active = students.filter((s) => s.connected).length
    const underAlert = students.filter((s) => s.status === 'alert').length
    const avgAttention = students.length ? Math.round(students.reduce((s, x) => s + x.attention, 0) / students.length) : 0
    return { total: students.length, active, underAlert, avgAttention, todayAlerts: alerts.length }
  }, [students, alerts])

  const openById = (id) => {
    const s = students.find((x) => x.id === id)
    if (s) setSelected(s)
  }
  const liveSelected = selected ? students.find((s) => s.id === selected.id) || selected : null
  const selectedAlerts = liveSelected ? alerts.filter((a) => a.studentId === liveSelected.id) : []

  if (exam?.is_closed) {
    return (
      <main className="mx-auto max-w-[1600px] px-4 py-5">
        <Link to="/teacher/exams" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Exams
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">This exam's submission window has closed.</p>
          <p className="mt-1 text-xs text-slate-400">Live monitoring is no longer available — grading and past results are still accessible from the Grading page.</p>
          <Link to={`/teacher/grading/${examId}`} className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">Go to Grading →</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-5">
      <Link to="/teacher/exams" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Exams
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">{exam?.title || 'Live Monitoring'}</h1>
          <p className="mt-0.5 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {stats.active} active candidates</span>
            <span className="flex items-center gap-1 text-rose-500"><Flag className="h-3.5 w-3.5" /> {stats.underAlert} flagged</span>
          </p>
        </div>
        {exam?.duration_minutes && (
          <span className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Clock className="h-4 w-4" /> {exam.duration_minutes} min exam
          </span>
        )}
      </div>

      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            <StatCard icon={UsersIcon} label="Total Students" value={stats.total} accent="brand" />
            <StatCard icon={UserCheck} label="Active" value={stats.active} sub={`${stats.total - stats.active} offline`} accent="emerald" />
            <StatCard icon={AlertTriangle} label="Under Alert" value={stats.underAlert} accent="rose" pulse={stats.underAlert > 0} />
            <StatCard icon={BellRing} label="Alerts Today" value={stats.todayAlerts} accent="amber" />
            <StatCard icon={Gauge} label="Avg Attention" value={`${stats.avgAttention}%`} accent="brand" />
            <StatCard icon={ShieldCheck} label="AI Status" value="Online" sub="all models active" accent="emerald" />
          </>
        )}
      </section>

      <section className="mt-5">{!loading && <Charts students={students} alerts={alerts} />}</section>

      <section className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <SearchFilterBar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} alertCount={stats.underAlert} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {loading ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />) : filtered.map((st) => (
              <StudentCard key={st.id} student={st} onOpen={setSelected} frame={frames[st.id]} />
            ))}
          </div>
          {!loading && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center dark:border-slate-700">
              <p className="text-sm font-medium text-slate-500">No students match your filters</p>
              <p className="mt-1 text-xs text-slate-400">Try clearing the search or switching filters.</p>
            </div>
          )}
        </div>
        <aside className="xl:sticky xl:top-20 xl:self-start">
          <AlertPanel onView={openById} />
        </aside>
      </section>

      {liveSelected && (
        <StudentDetailModal
          student={liveSelected}
          onClose={() => setSelected(null)}
          alerts={selectedAlerts}
          frame={frames[liveSelected.id]}
        />
      )}
    </main>
  )
}