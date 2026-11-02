export function ProgressBar({ value, color = 'bg-brand-600', height = 'h-2' }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700 ${height}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${value}%` }} />
    </div>
  )
}

export function Stepper({ steps, current }) {
  return (
    <div className="flex items-center">
      {steps.map((step, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={step} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : active
                    ? 'bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-500/20'
                    : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                }`}
              >
                {done ? '✓' : i + 1}
              </div>
              <span className={`hidden text-[10px] font-medium sm:block ${active ? 'text-brand-700 dark:text-brand-400' : 'text-slate-400'}`}>
                {step}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`mx-1.5 h-0.5 flex-1 rounded transition-colors ${done ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
