import { Bell, Palette, ShieldCheck, User } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import Avatar from '../../components/Avatar'

export default function SettingsPage() {
  const { user } = useAuth()
  const { theme, toggle } = useTheme()

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Settings</h1>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Manage your account and preferences.</p>

      <div className="mt-5 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><User className="h-4 w-4" /> Profile</h2>
          <div className="flex items-center gap-3">
            <Avatar name={user?.name || 'User'} size="lg" />
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{user?.name}</p>
              <p className="text-xs text-slate-400">{user?.email}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><Palette className="h-4 w-4" /> Appearance</h2>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-300">Dark mode</span>
            <button
              onClick={toggle}
              className={`relative h-6 w-11 rounded-full transition-colors ${theme === 'dark' ? 'bg-brand-600' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${theme === 'dark' ? 'translate-x-5.5' : 'translate-x-0.5'}`} style={{ transform: theme === 'dark' ? 'translateX(22px)' : 'translateX(2px)' }} />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><Bell className="h-4 w-4" /> Notifications</h2>
          <label className="flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-300">Email me when a candidate is flagged</span>
            <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300 text-brand-600" />
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><ShieldCheck className="h-4 w-4" /> Default Security Requirements</h2>
          <p className="text-xs text-slate-400">These apply as defaults whenever you create a new exam.</p>
        </div>
      </div>
    </main>
  )
}
