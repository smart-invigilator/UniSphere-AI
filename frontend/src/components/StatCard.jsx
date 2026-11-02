export default function StatCard({ icon: Icon, label, value, sub, accent = 'brand', pulse = false }) {
  const accents = {
    brand: 'text-brand-600 bg-brand-50 dark:bg-brand-500/10 dark:text-brand-400',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400',
    rose: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400',
    slate: 'text-slate-600 bg-slate-100 dark:bg-slate-700/40 dark:text-slate-300',
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
          {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
        </div>
        <span className={`relative flex h-9 w-9 items-center justify-center rounded-lg ${accents[accent]}`}>
          {pulse && <span className="absolute inset-0 rounded-lg bg-current opacity-20 animate-ping" />}
          <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
        </span>
      </div>
    </div>
  )
}
