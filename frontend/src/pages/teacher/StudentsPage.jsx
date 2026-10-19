import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useExams } from '../../context/ExamContext'
import { api } from '../../services/api'
import Avatar from '../../components/Avatar'
import { Badge } from '../../components/common/EmptyState'
import { timeAgo } from '../../utils/format'

export default function StudentsPage() {
  const { courses } = useExams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [rosters, setRosters] = useState({}) 
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (courses.length === 0) {
      setLoading(false)
      return
    }
    setLoading(true)
    Promise.all(courses.map((c) => api.get(`/courses/${c.id}/roster`).then((r) => [c.id, r]).catch(() => [c.id, []])))
      .then((entries) => setRosters(Object.fromEntries(entries)))
      .finally(() => setLoading(false))
  }, [courses])

  const combined = useMemo(() => {
    const byEmail = new Map()
    for (const c of courses) {
      for (const s of rosters[c.id] || []) {
        const existing = byEmail.get(s.email) || { ...s, courseTitles: [] }
        existing.courseTitles.push(c.title)
        byEmail.set(s.email, existing)
      }
    }
    return Array.from(byEmail.values())
  }, [courses, rosters])

  const filtered = useMemo(() => {
    let list = combined
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || s.student_id.toLowerCase().includes(q))
    }
    if (filter === 'self') list = list.filter((s) => s.method === 'self')
    if (filter === 'manual') list = list.filter((s) => s.method === 'manual')
    return list
  }, [combined, query, filter])

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Students</h1>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Every student enrolled across your courses.</p>

      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, or ID…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          {['all', 'manual', 'self'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${filter === f ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-300' : 'text-slate-500'}`}
            >
              {f === 'all' ? 'all' : f === 'self' ? 'self-enrolled' : 'added by you'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Courses</th>
              <th className="px-4 py-3 font-medium">Enrolled</th>
              <th className="px-4 py-3 font-medium">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((s) => (
              <tr key={s.email} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={s.name} size="sm" />
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{s.name}</p>
                      <p className="font-mono text-[11px] text-slate-400">{s.student_id}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{s.email}</td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{s.courseTitles.join(', ')}</td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{timeAgo(new Date(s.enrolled_at).getTime())}</td>
                <td className="px-4 py-3"><Badge color={s.method === 'self' ? 'violet' : 'slate'}>{s.method === 'self' ? 'Self-enrolled' : 'Added by you'}</Badge></td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No students match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}
