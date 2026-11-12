import { useCallback, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Shield, Mail, ArrowLeft } from 'lucide-react'
import PasswordInput from '../components/common/PasswordInput'
import { useAuth } from '../context/AuthContext'
import { useNotify } from '../context/NotifyContext'
import Button from '../components/common/Button'
import FaceScan360 from '../components/face/FaceScan360'

const homeFor = (role) => (role === 'teacher' || role === 'admin' ? '/teacher/dashboard' : '/student/dashboard')
const safeReturnPath = (from) => (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : null)

export default function LoginPage() {
  const { login, completeFaceLogin } = useAuth()
  const notify = useNotify()
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = safeReturnPath(location.state?.from)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [challenge, setChallenge] = useState(null)
  const [scanKey, setScanKey] = useState(0)
  const [verifying, setVerifying] = useState(false)

  const [loading, setLoading] = useState(false)

  const handleLoginResult = (result) => {
    if (result?.faceRequired) {
      setChallenge(result)
      setScanKey((k) => k + 1)
      return
    }
    notify.success('Login successful. Welcome back!')
    navigate(returnTo || homeFor(result.role))
  }

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      handleLoginResult(await login({ email, password }))
    } catch (err) {
      notify.error(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const onScanComplete = useCallback(async ({ frames }) => {
    if (!challenge) return
    setVerifying(true)
    try {
      const user = await completeFaceLogin({ faceToken: challenge.faceToken, faceScan: frames })
      notify.success('Face verified. Login successful!')
      navigate(returnTo || homeFor(user.role))
    } catch (err) {
      if (err?.status === 401) {
        setChallenge(null)
        notify.error(err.message || 'Your login session expired. Enter your password again.')
      } else {
        notify.error(err.message || 'Face verification failed. Please scan again.')
        setScanKey((k) => k + 1)
      }
    } finally {
      setVerifying(false)
    }
  }, [challenge, completeFaceLogin, navigate, notify, returnTo])

  const backToPassword = () => {
    setChallenge(null)
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
          {challenge ? (
            <>
              <button type="button" onClick={backToPassword} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                {challenge.faceEnrolled ? 'Verify it’s you' : 'Set up your 360° face scan'}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {challenge.faceEnrolled
                  ? `Hi ${challenge.name}, complete a quick 360° face scan to finish logging in.`
                  : `Hi ${challenge.name}, your account needs a one-time 360° face scan. It will be checked against your registered photo.`}
              </p>
              <div className="mt-4">
                <FaceScan360
                  key={scanKey}
                  title="Face Verification"
                  onComplete={onScanComplete}
                  busy={verifying}
                  autoStart={scanKey > 1}
                />
              </div>
            </>
          ) : (
            <>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">Welcome back</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Log in to continue to your dashboard.</p>

              <form onSubmit={submit} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Email</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@campus.edu"
                      className="auth-input w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>
                <PasswordInput
                  id="password" label="Password" required value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                />
                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="auth-checkbox h-4 w-4 rounded border-slate-300" />
                    Remember me
                  </label>
                  <button type="button" className="font-medium text-brand-600 hover:underline">Forgot password?</button>
                </div>
                <Button type="submit" className="w-full" size="lg" disabled={loading}>{loading ? 'Logging in…' : 'Log in'}</Button>
              </form>

              <p className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
                Don't have an account? <Link to="/register" className="font-semibold text-brand-600 hover:underline">Register</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}