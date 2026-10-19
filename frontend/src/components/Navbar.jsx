import { Shield, Moon, Sun, Wifi, WifiOff } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { useMonitor } from '../context/MonitorContext'

export default function Navbar() {
  const { theme, toggle } = useTheme()
  const { connected } = useMonitor()
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Shield className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
          </span>
          <div>
            <h1 className="text-sm font-bold leading-tight text-slate-900 dark:text-white">UniSphere AI</h1>
            <p className="text-[10px] leading-tight text-slate-400">Exam Monitoring Console</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              connected
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
            }`}
          >
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connected ? 'AI Monitoring Active' : 'Connecting…'}
          </span>
          <button
            onClick={toggle}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  )
}
