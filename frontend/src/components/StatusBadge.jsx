const MAP = {
  normal: { label: 'Normal', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  alert: { label: 'Alert', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400' },
  offline: { label: 'Offline', cls: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
}

export default function StatusBadge({ status }) {
  const s = MAP[status] || MAP.normal
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      {status === 'alert' && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
      {s.label}
    </span>
  )
}
