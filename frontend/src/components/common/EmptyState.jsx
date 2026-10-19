export default function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-14 text-center dark:border-slate-700">
      {Icon && (
        <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {message && <p className="max-w-xs text-xs text-slate-400">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Badge({ children, color = 'slate' }) {
  const map = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[color]}`}>
      {children}
    </span>
  )
}
