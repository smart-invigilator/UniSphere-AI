import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { FileBarChart2, ShieldAlert, Users, CheckCircle2 } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { useExams } from '../../context/ExamContext'
import { api } from '../../services/api'
import StatCard from '../../components/StatCard'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'

const PIE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#f43f5e']

export default function ReportsPage() {
  const { theme } = useTheme()
  const { exams } = useExams()
  const grid = theme === 'dark' ? '#1e293b' : '#e2e8f0'
  const axis = theme === 'dark' ? '#64748b' : '#94a3b8'
  const tooltipStyle = { background: theme === 'dark' ? '#0f172a' : '#fff', border: `1px solid ${grid}`, borderRadius: 8, fontSize: 12, color: theme === 'dark' ? '#e2e8f0' : '#0f172a' }

  const [summary, setSummary] = useState(null)
  const [attempts, setAttempts] = useState([])

  useEffect(() => {
    api.get('/analytics/summary').then(setSummary).catch(() => {})
  }, [])

  useEffect(() => {
    if (exams.length === 0) return
    Promise.all(
      exams.map((e) => api.get(`/attempts/exam/${e.id}`).then((rows) => rows.map((r) => ({ ...r, examTitle: e.title }))).catch(() => []))
    ).then((lists) => setAttempts(lists.flat()))
  }, [exams])

  const violationData = useMemo(() => {
    const byType = summary?.alertsByType || {}
    return Object.entries(byType).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [summary])

  const completionData = useMemo(() => {
    const counts = { 'Not Started': 0, 'In Progress': 0, Submitted: 0, Graded: 0 }
    attempts.forEach((a) => {
      if (a.status === 'not_started' || a.status === 'checklist') counts['Not Started'] += 1
      else if (a.status === 'in_progress') counts['In Progress'] += 1
      else if (a.status === 'submitted') counts.Submitted += 1
      else if (a.status === 'graded') counts.Graded += 1
    })
    return Object.entries(counts).map(([name, value]) => ({ name, value })).filter((d) => d.value > 0)
  }, [attempts])

  const submittedAttempts = attempts
    .filter((a) => a.status === 'submitted' || a.status === 'graded')
    .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0))
    .slice(0, 20)

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Reports</h1>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Aggregate exam activity and integrity trends.</p>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Students" value={summary?.totalStudents ?? '—'} accent="brand" />
        <StatCard icon={ShieldAlert} label="Total Alerts" value={summary?.totalAlerts ?? '—'} accent="rose" />
        <StatCard icon={FileBarChart2} label="Submitted Attempts" value={submittedAttempts.length} accent="amber" />
        <StatCard icon={CheckCircle2} label="Avg Attention (live)" value={summary ? `${summary.avgAttention}%` : '—'} accent="emerald" />
      </section>

      <section className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Most Common Violation Types">
          {violationData.length === 0 ? (
            <p className="flex h-[220px] items-center justify-center text-xs text-slate-400">No alerts recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={violationData} layout="vertical" margin={{ left: 100, right: 12 }}>
                <CartesianGrid stroke={grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke={axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" stroke={axis} fontSize={9} width={140} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.1)' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Attempt Status Breakdown">
          {completionData.length === 0 ? (
            <p className="flex h-[220px] items-center justify-center text-xs text-slate-400">No exam attempts yet.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={completionData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                    {completionData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-1 flex flex-wrap justify-center gap-3">
                {completionData.map((d, i) => (
                  <span key={d.name} className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                    <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} /> {d.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </Panel>
      </section>

      <section className="mt-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent Submissions</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3 font-medium">Attempt</th>
                <th className="px-4 py-3 font-medium">Exam</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {submittedAttempts.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">#{a.id}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{a.examTitle}</td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-slate-700 dark:text-slate-200">{a.final_score ?? a.auto_score}</span>
                  </td>
                  <td className="px-4 py-3"><Badge color={a.status === 'graded' ? 'emerald' : 'amber'}>{a.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <Button as={Link} to={`/teacher/grading/${a.exam_id}`} size="sm" variant="outline">Grade</Button>
                  </td>
                </tr>
              ))}
              {submittedAttempts.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No submissions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function Panel({ title, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      {children}
    </div>
  )
}
