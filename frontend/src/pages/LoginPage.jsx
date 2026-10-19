import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Shield, GraduationCap, ClipboardCheck, Mail, Lock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Button from '../components/common/Button'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const loggedIn = await login({ email, password })
      navigate(loggedIn.role === 'teacher' || loggedIn.role === 'admin' ? '/teacher/dashboard' : '/student/dashboard')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const quickLogin = async (r) => {
    setError('')
    setLoading(true)
    try {
      const creds = r === 'teacher'
        ? { email: 'teacher@proctor.io', password: 'teacher123' }
        : { email: 'student1@proctor.io', password: 'student123' }
      const loggedIn = await login(creds)
      navigate(loggedIn.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard')
    } catch (err) {
      setError(err.message || 'Demo login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Shield className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
          </span>
          <span className="text-base font-bold text-slate-900 dark:text-white">UniSphere AI</span>
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Log in to continue to your dashboard.</p>

          {error && (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>
          )}

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@campus.edu"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Password</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="rounded border-slate-300" />
                Remember me
              </label>
              <button type="button" className="font-medium text-brand-600 hover:underline">Forgot password?</button>
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>{loading ? 'Logging in…' : 'Log in'}</Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /> Or try a quick demo <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" icon={GraduationCap} onClick={() => quickLogin('student')}>Continue as Student</Button>
            <Button variant="outline" icon={ClipboardCheck} onClick={() => quickLogin('teacher')}>Continue as Teacher</Button>
          </div>

          <p className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
            Don't have an account? <Link to="/register" className="font-semibold text-brand-600 hover:underline">Register</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
