import { useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Shield, User, Mail, GraduationCap, ClipboardCheck, CheckCircle2, Circle } from 'lucide-react'
import PasswordInput from '../components/common/PasswordInput'
import { PASSWORD_RULES, passwordProblems } from '../utils/password'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import Button from '../components/common/Button'
import FaceScan360 from '../components/face/FaceScan360'

export default function RegisterPage() {
  const { register } = useAuth()
  const notify = useNotify()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', role: 'student' })
  const [faceScan, setFaceScan] = useState(null)
  const [scanKey, setScanKey] = useState(0)
  const [loading, setLoading] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const onScanComplete = useCallback(({ frames }) => {
    setFaceScan(frames)
    notify.success('Face scan captured.')
  }, [notify])

  const submit = async (e) => {
    e.preventDefault()
    if (form.password !== form.confirm) {
      notify.error("Passwords don't match.")
      return
    }
    const problems = passwordProblems(form.password)
    if (problems.length) {
      notify.error(`Password must have: ${problems.join(', ').toLowerCase()}.`)
      return
    }
    if (form.role === 'student' && !faceScan?.length) {
      notify.error('Please complete the 360° face scan to finish registration.')
      return
    }
    setLoading(true)
    try {
      const registered = await register({ ...form, faceScan })
      notify.success('Account created successfully. Welcome!')
      navigate(registered.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard')
    } catch (err) {
      notify.error(err.message || 'Registration failed')
      if (err?.status === 400 && /scan|view|person/i.test(err.message || '')) {
        setFaceScan(null)
        setScanKey((k) => k + 1)
      }
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
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Set up access for either role.</p>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[{ id: 'student', label: 'Student', icon: GraduationCap }, { id: 'teacher', label: 'Teacher', icon: ClipboardCheck }].map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, role: r.id }))}
                className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-semibold transition-colors ${
                  form.role === r.id
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                }`}
              >
                <r.icon className="h-4 w-4" /> {r.label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field icon={User} id="name" label="Full Name" value={form.name} onChange={set('name')} placeholder="Jordan Lee" required />
            <Field icon={Mail} id="email" type="email" label="Email" value={form.email} onChange={set('email')} placeholder="you@campus.edu" required />
            <div>
              <PasswordInput id="password" label="Password" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="••••••••" required />
              <ul className="mt-2 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
                {PASSWORD_RULES.map((r) => {
                  const ok = r.test(form.password)
                  return (
                    <li key={r.id} className={`flex items-center gap-1.5 ${ok ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />} {r.label}
                    </li>
                  )
                })}
              </ul>
            </div>
            <PasswordInput id="confirm" label="Confirm Password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} placeholder="••••••••" required />
            {form.role === 'student' && (
              <FaceScan360
                key={scanKey}
                title="Face Scan (required)"
                description="Your face is scanned from the front and both sides. It is used to verify you at every login and during your exams."
                onComplete={onScanComplete}
                busy={loading}
              />
            )}
            <Button type="submit" className="w-full" size="lg" disabled={loading}>{loading ? 'Creating…' : 'Create Account'}</Button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
            Already have an account? <Link to="/login" className="font-semibold text-brand-600 hover:underline">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

function Field({ icon: Icon, id, label, type = 'text', ...props }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id={id} type={type} {...props}
          className="auth-input w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
      </div>
    </div>
  )
}