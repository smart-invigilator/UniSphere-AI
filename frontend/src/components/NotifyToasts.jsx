import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { useNotifyItems } from '../context/NotifyContext'

const STYLES = {
  success: { icon: CheckCircle2, ring: 'border-emerald-200 dark:border-emerald-500/30', chip: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400', title: 'Success' },
  error: { icon: XCircle, ring: 'border-rose-200 dark:border-rose-500/30', chip: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400', title: 'Error' },
  warning: { icon: AlertTriangle, ring: 'border-amber-200 dark:border-amber-500/30', chip: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400', title: 'Warning' },
  info: { icon: Info, ring: 'border-brand-200 dark:border-brand-500/30', chip: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400', title: 'Info' },
}

export default function NotifyToasts() {
  const { items, dismiss } = useNotifyItems()
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
      aria-live="polite"
    >
      {items.map((n) => {
        const s = STYLES[n.type] || STYLES.info
        const Icon = s.icon
        return (
          <div
            key={n.id}
            role={n.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto animate-slide-in rounded-lg border bg-white p-3 shadow-lg dark:bg-slate-800 ${s.ring}`}
          >
            <div className="flex items-start gap-2.5">
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${s.chip}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{n.title || s.title}</p>
                <p className="mt-0.5 break-words text-xs text-slate-500 dark:text-slate-400">{n.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(n.id)}
                aria-label="Dismiss notification"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
