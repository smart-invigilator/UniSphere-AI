import { Link } from 'react-router-dom'
import { Radio, CalendarClock, CheckCircle2, Copy, Users, XCircle, Play } from 'lucide-react'
import Button from '../common/Button'

export function formatWhen(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const STATUS = {
  live: { label: 'Live now', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', icon: Radio },
  scheduled: { label: 'Scheduled', cls: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300', icon: CalendarClock },
  ended: { label: 'Ended', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', icon: CheckCircle2 },
}

export function LiveClassCard({ lc, isTeacher, onStart, onCancel, onAttendance, onCopy, busy }) {
  const meta = STATUS[lc.status] || STATUS.ended
  const Icon = meta.icon
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900" data-testid="live-class-card" data-status={lc.status}>
      <div className="min-w-0">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
          <Icon className={`h-3 w-3 ${lc.status === 'live' ? 'animate-pulse' : ''}`} /> {meta.label}
        </span>
        <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{lc.title}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {lc.course_title} · {lc.status === 'ended' ? `ended ${formatWhen(lc.ended_at)}` : lc.status === 'live' ? `started ${formatWhen(lc.started_at)}` : formatWhen(lc.scheduled_start)}
          {!isTeacher && ` · ${lc.teacher_name}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {lc.status === 'live' && (
          <Button as={Link} to={`/live/${lc.ref}`} size="sm" icon={Radio}>{isTeacher ? 'Open class' : 'Join'}</Button>
        )}
        {isTeacher && lc.status === 'scheduled' && (
          <>
            <Button size="sm" icon={Play} disabled={busy} onClick={() => onStart(lc)}>Start now</Button>
            <Button size="sm" variant="ghost" icon={XCircle} disabled={busy} onClick={() => onCancel(lc)}>Cancel</Button>
          </>
        )}
        {isTeacher && lc.status !== 'scheduled' && (
          <Button size="sm" variant="outline" icon={Users} onClick={() => onAttendance(lc)}>Attendance</Button>
        )}
        {isTeacher && lc.status !== 'ended' && (
          <Button size="sm" variant="outline" icon={Copy} onClick={() => onCopy(lc)}>Copy link</Button>
        )}
      </div>
    </div>
  )
}