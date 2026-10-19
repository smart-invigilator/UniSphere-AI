import { memo } from 'react'
import { Bell, ChevronRight, Clock } from 'lucide-react'
import Avatar from './Avatar'
import StatusBadge from './StatusBadge'
import AttentionBar from './AttentionBar'
import LiveFeed from './LiveFeed'
import { timeAgo } from '../utils/format'

function StudentCard({ student, onOpen, frame }) {
  const isAlert = student.status === 'alert'
  return (
    <div
      className={`group animate-fade-up rounded-xl border bg-white transition-all dark:bg-slate-900 ${
        isAlert
          ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-500/50 dark:ring-rose-500/20 animate-pulse-ring'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between gap-2 p-3 pb-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={student.name} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{student.name}</p>
            <p className="font-mono text-[11px] text-slate-400">{student.id}</p>
          </div>
        </div>
        <StatusBadge status={student.connected ? student.status : 'offline'} />
      </div>

      <div className="grid grid-cols-2 gap-2 px-3">
        <FrameOrPlaceholder type="face" image={frame?.webcam} seed={student.id} connected={student.connected} />
        <FrameOrPlaceholder type="screen" image={frame?.screen} seed={student.id + 's'} connected={student.connected} />
      </div>

      <div className="space-y-2.5 p-3">
        <AttentionBar score={student.attention} />
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Bell className="h-3 w-3" />
            <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{student.alertCount}</span> alerts
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo(student.lastActivity)}
          </span>
        </div>
        <button
          onClick={() => onOpen(student)}
          className="flex w-full items-center justify-center gap-1 rounded-lg bg-slate-100 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-brand-600 hover:text-white dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-brand-600"
        >
          View details
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function FrameOrPlaceholder({ type, image, seed, connected }) {
  if (image) {
    return (
      <div className="relative h-24 w-full overflow-hidden rounded-lg bg-slate-900">
        <img src={image} alt={`${type} feed`} className="h-full w-full object-cover" />
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-white">Live</span>
        </div>
      </div>
    )
  }
  return <LiveFeed type={type} seed={seed} connected={connected} size="sm" />
}

export default memo(StudentCard)