import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Moon, Sun, LogOut, ChevronDown } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import Avatar from '../Avatar'

export default function AppNavbar({ leading }) {
  const { theme, toggle } = useTheme()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          {leading}
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Shield className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
          </span>
          <div>
            <h1 className="text-sm font-bold leading-tight text-slate-900 dark:text-white">UniSphere AI</h1>
            <p className="text-[10px] capitalize leading-tight text-slate-400">{user?.role} Console</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 py-1 pl-1 pr-2 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <Avatar name={user?.name || 'User'} size="sm" />
              <span className="hidden text-xs font-medium text-slate-700 dark:text-slate-200 sm:block">{user?.name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-10 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-700">
                  <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{user?.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                >
                  <LogOut className="h-3.5 w-3.5" /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
