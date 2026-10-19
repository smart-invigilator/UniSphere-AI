const MAP = {
  high: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/30',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30',
  low: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/30',
}
export default function SeverityTag({ severity }) {
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${MAP[severity] || MAP.low}`}>
      {severity}
    </span>
  )
}
