import { useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useTheme } from '../context/ThemeContext'
import { ALERT_TYPES } from '../data/mockData'

function Panel({ title, children, className = '' }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      {children}
    </div>
  )
}

const PIE_COLORS = ['#10b981', '#f59e0b', '#f43f5e']

export default function Charts({ students, alerts }) {
  const { theme } = useTheme()
  const grid = theme === 'dark' ? '#1e293b' : '#e2e8f0'
  const axis = theme === 'dark' ? '#64748b' : '#94a3b8'

  const trend = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      t: `${i * 5}m`,
      alerts: 0,
    }))
    const now = Date.now()
    alerts.forEach((a) => {
      const mins = Math.floor((now - a.timestamp) / 60000)
      const idx = Math.min(11, Math.floor(mins / 5))
      buckets[11 - idx].alerts += 1
    })
    return buckets
  }, [alerts])

  const attentionDist = useMemo(() => {
    const d = [
      { name: 'High (80+)', value: 0 },
      { name: 'Moderate (60-79)', value: 0 },
      { name: 'Low (<60)', value: 0 },
    ]
    students.forEach((s) => {
      if (s.attention >= 80) d[0].value++
      else if (s.attention >= 60) d[1].value++
      else d[2].value++
    })
    return d
  }, [students])

  const categories = useMemo(() => {
    const counts = {}
    ALERT_TYPES.forEach((t) => (counts[t.type] = 0))
    alerts.forEach((a) => (counts[a.type] = (counts[a.type] || 0) + 1))
    return Object.entries(counts)
      .map(([name, value]) => ({ name: name.replace(/ detected| from screen/, ''), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [alerts])

  const activity = useMemo(
    () =>
      students.slice(0, 10).map((s) => ({
        name: s.name.split(' ')[0],
        attention: s.attention,
      })),
    [students]
  )

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="Alert Trends (last hour)">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={trend} margin={{ left: -20, right: 8, top: 4 }}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" stroke={axis} fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke={axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle(theme)} />
            <Area type="monotone" dataKey="alerts" stroke="#3b82f6" strokeWidth={2} fill="url(#g1)" />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Student Attention Overview">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={activity} margin={{ left: -20, right: 8, top: 4 }}>
            <CartesianGrid stroke={grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" stroke={axis} fontSize={10} tickLine={false} axisLine={false} />
            <YAxis stroke={axis} fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
            <Tooltip contentStyle={tooltipStyle(theme)} cursor={{ fill: 'rgba(148,163,184,0.1)' }} />
            <Bar dataKey="attention" radius={[4, 4, 0, 0]} fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Attention Distribution">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie data={attentionDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3}>
              {attentionDist.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle(theme)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="mt-1 flex justify-center gap-3">
          {attentionDist.map((d, i) => (
            <span key={d.name} className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i] }} />
              {d.name}
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="Alert Categories">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={categories} layout="vertical" margin={{ left: 40, right: 12 }}>
            <CartesianGrid stroke={grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" stroke={axis} fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" stroke={axis} fontSize={9} width={80} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle(theme)} cursor={{ fill: 'rgba(148,163,184,0.1)' }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#8b5cf6" />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  )
}

function tooltipStyle(theme) {
  return {
    background: theme === 'dark' ? '#0f172a' : '#fff',
    border: `1px solid ${theme === 'dark' ? '#1e293b' : '#e2e8f0'}`,
    borderRadius: 8,
    fontSize: 12,
    color: theme === 'dark' ? '#e2e8f0' : '#0f172a',
  }
}
