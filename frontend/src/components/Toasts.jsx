import { AlertTriangle, X } from 'lucide-react'
import { useMonitor } from '../context/MonitorContext'
import SeverityTag from './SeverityTag'

export default function Toasts() {
  const { toasts, dismissToast } = useMonitor()
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto animate-slide-in rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{t.title}</p>
                <SeverityTag severity={t.severity} />
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t.message}</p>
            </div>
            <button onClick={() => dismissToast(t.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
