import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  Camera, Mic, MonitorUp, ScanFace, Fingerprint, ShieldCheck,
  CheckCircle2, Loader2, ArrowLeft, ArrowRight, XCircle, RotateCcw,
} from 'lucide-react'
import { useExams } from '../../context/ExamContext'
import { useProctorSession } from '../../context/ProctorSessionContext'
import { api, ApiError } from '../../services/api'
import { Stepper, ProgressBar } from '../../components/common/ProgressBar'
import Button from '../../components/common/Button'
import LiveFeed from '../../components/LiveFeed'
import { captureFrame, waitForVideoReady } from '../../utils/media'

const ALL_STEPS = [
  { key: 'camera', label: 'Camera', icon: Camera, securityKey: 'camera' },
  { key: 'microphone', label: 'Microphone', icon: Mic, securityKey: 'microphone' },
  { key: 'screenShare', label: 'Screen', icon: MonitorUp, securityKey: 'screenShare' },
  { key: 'identity', label: 'Identity', icon: ScanFace, securityKey: 'identity' },
  { key: 'liveness', label: 'Liveness', icon: Fingerprint, securityKey: 'liveness' },
  { key: 'ready', label: 'Ready', icon: ShieldCheck, securityKey: null },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function PreExamCheck() {
  const { examId } = useParams()
  const { findExam, startAttempt } = useExams()
  const {
    cameraStream, setCameraStream, micStream, setMicStream, screenStream, setScreenStream,
    setAttempt: persistAttempt,
  } = useProctorSession()
  const navigate = useNavigate()

  const [exam, setExam] = useState(() => findExam(examId) || null)
  const [attempt, setAttemptState] = useState(null)
  const [initError, setInitError] = useState(null)
  const [initializing, setInitializing] = useState(true)

  const [stepIndex, setStepIndex] = useState(0)
  const [status, setStatus] = useState({})     
  const [stepError, setStepError] = useState({})
  const [enterError, setEnterError] = useState(null)
  const [entering, setEntering] = useState(false)

  const camVideoRef = useRef(null) 
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setInitializing(true)
      try {
        let e = findExam(examId)
        if (!e) e = await api.get(`/exams/${examId}`)
        if (cancelled) return
        setExam(e)
        const a = await startAttempt(examId)
        if (cancelled) return
        setAttemptState(a)
        persistAttempt(a.id, e.id)
        setStatus({
          camera: (a.camera_ok && cameraStream) ? 'passed' : 'pending',
          microphone: (a.microphone_ok && micStream) ? 'passed' : 'pending',
          screenShare: (a.screen_ok && screenStream) ? 'passed' : 'pending',
          identity: a.identity_verified ? 'passed' : 'pending',
          liveness: a.liveness_ok ? 'passed' : 'pending',
        })
      } catch (e) {
        if (!cancelled) setInitError(e.message || 'Could not start this exam attempt')
      } finally {
        if (!cancelled) setInitializing(false)
      }
    })()
    return () => { cancelled = true }
  }, [examId])

  useEffect(() => {
    const el = camVideoRef.current
    if (!el) return
    el.srcObject = cameraStream || null
    if (cameraStream) el.play?.().catch(() => {})
  }, [cameraStream])

  const STEPS = ALL_STEPS.filter((s) => !s.securityKey || exam?.security?.[s.securityKey] !== false)
  const currentKey = STEPS[stepIndex]?.key
  const currentStatus = status[currentKey] || 'pending'

  const setKeyStatus = (key, s) => setStatus((prev) => ({ ...prev, [key]: s }))
  const setKeyError = (key, msg) => setStepError((prev) => ({ ...prev, [key]: msg }))

  const next = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  const back = () => setStepIndex((i) => Math.max(i - 1, 0))

  const allPassed = STEPS.filter((s) => s.key !== 'ready').every((s) => status[s.key] === 'passed')

  const allowCamera = async () => {
    setKeyStatus('camera', 'checking')
    setKeyError('camera', null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      setCameraStream(stream)
      await api.post(`/attempts/${attempt.id}/checklist/camera`)
      setKeyStatus('camera', 'passed')
    } catch (e) {
      setKeyStatus('camera', 'failed')
      setKeyError('camera', mediaErrorMessage(e, 'camera'))
    }
  }

  const allowMicrophone = async () => {
    setKeyStatus('microphone', 'checking')
    setKeyError('microphone', null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setMicStream(stream)
      await api.post(`/attempts/${attempt.id}/checklist/microphone`)
      setKeyStatus('microphone', 'passed')
    } catch (e) {
      setKeyStatus('microphone', 'failed')
      setKeyError('microphone', mediaErrorMessage(e, 'microphone'))
    }
  }

  const allowScreen = async () => {
    setKeyStatus('screenShare', 'checking')
    setKeyError('screenShare', null)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const track = stream.getVideoTracks()[0]
      const displaySurface = track?.getSettings?.().displaySurface
      if (displaySurface && displaySurface !== 'monitor') {
        track.stop()
        setKeyStatus('screenShare', 'failed')
        setKeyError(
          'screenShare',
          'Please share your ENTIRE SCREEN, not a single window or tab. Click "Share Screen" again and choose your whole monitor.',
        )
        return
      }
      setScreenStream(stream)
      await api.post(`/attempts/${attempt.id}/checklist/screen`)
      setKeyStatus('screenShare', 'passed')
      track?.addEventListener('ended', () => {
        setKeyStatus('screenShare', 'failed')
        setKeyError('screenShare', 'Screen sharing was stopped. It must stay active for the whole exam — share again.')
      })
    } catch (e) {
      setKeyStatus('screenShare', 'failed')
      setKeyError('screenShare', mediaErrorMessage(e, 'screen share'))
    }
  }

  const [captureProgress, setCaptureProgress] = useState(0)
  const runIdentityEnroll = async () => {
    if (!cameraStream) {
      setKeyError('identity', 'Complete the camera check first.')
      return
    }
    setKeyStatus('identity', 'checking')
    setKeyError('identity', null)
    setCaptureProgress(0)
    try {
      const ready = await waitForVideoReady(camVideoRef.current, 4000)
      if (!ready) {
        setKeyStatus('identity', 'failed')
        setKeyError('identity', "Camera feed isn't ready yet. Wait a moment and try again.")
        return
      }
      const frames = []
      const FRAME_COUNT = 7
      for (let i = 0; i < FRAME_COUNT; i++) {
        await sleep(300)
        const f = captureFrame(camVideoRef.current, 0.85)
        if (f) frames.push(f)
        setCaptureProgress(Math.round(((i + 1) / FRAME_COUNT) * 100))
      }
      if (frames.length === 0) {
        setKeyStatus('identity', 'failed')
        setKeyError('identity', "Couldn't capture any usable frames from your camera. Try again.")
        return
      }
      const res = await api.post(`/attempts/${attempt.id}/checklist/enroll-face`, { frames })
      setKeyStatus('identity', res.identity_verified ? 'passed' : 'failed')
      if (!res.identity_verified) setKeyError('identity', 'Identity verification failed. Please try again')
    } catch (e) {
      setKeyStatus('identity', 'failed')
      setKeyError('identity', apiErrorMessage(e))
    }
  }

  const [livenessPrompt, setLivenessPrompt] = useState(null)
  const [livenessProgress, setLivenessProgress] = useState(0)

  const LIVENESS_REACTION_DELAY_MS = 600   
  const LIVENESS_POLL_INTERVAL_MS = 350    
  const LIVENESS_POLL_WINDOW_MS = 4500 

  const pollLivenessStep = async (step, extraPayload) => {
    await sleep(LIVENESS_REACTION_DELAY_MS)
    const deadline = Date.now() + LIVENESS_POLL_WINDOW_MS
    let lastResult = null
    while (Date.now() < deadline) {
      const frame = captureFrame(camVideoRef.current, 0.85)
      if (frame) {
        try {
          const res = await api.post(`/attempts/${attempt.id}/checklist/liveness/step`, {
            step, frame, ...extraPayload,
          })
          lastResult = res
          if (res.step_ok) return { ok: true, frame, result: res }
        } catch (e) {
          lastResult = { message: apiErrorMessage(e) }
        }
      }
      await sleep(LIVENESS_POLL_INTERVAL_MS)
    }
    return { ok: false, frame: null, result: lastResult }
  }

  const runLiveness = async () => {
    if (!cameraStream) {
      setKeyError('liveness', 'Complete the camera check first.')
      return
    }
    setKeyStatus('liveness', 'checking')
    setKeyError('liveness', null)
    setLivenessProgress(0)
    try {
      const ready = await waitForVideoReady(camVideoRef.current, 4000)
      if (!ready) {
        setKeyStatus('liveness', 'failed')
        setKeyError('liveness', "Camera feed isn't ready yet. Wait a moment and try again.")
        return
      }

      setLivenessPrompt('Look straight at the camera')
      setLivenessProgress(10)
      const straight = await pollLivenessStep('straight', {})
      if (!straight.ok) {
        setKeyStatus('liveness', 'failed')
        setKeyError('liveness', straight.result?.message || 'Could not confirm a straight-ahead position. Please try again from the beginning.')
        setLivenessPrompt('Please try again from the beginning.')
        setLivenessProgress(0)
        return
      }
      const center = straight.frame

      setLivenessPrompt('Turn your head slightly to the LEFT (just a little) — hold it there')
      setLivenessProgress(40)
      const left = await pollLivenessStep('left', { center_frame: center })
      if (!left.ok) {
        setKeyStatus('liveness', 'failed')
        setKeyError('liveness', left.result?.message || 'Could not confirm your left-facing position. Please try again from the beginning.')
        setLivenessPrompt('Please try again from the beginning.')
        setLivenessProgress(0)
        return
      }

      setLivenessPrompt('Turn your head slightly to the RIGHT (just a little) — hold it there')
      setLivenessProgress(70)
      const right = await pollLivenessStep('right', { center_frame: center })
      if (!right.ok) {
        setKeyStatus('liveness', 'failed')
        setKeyError('liveness', right.result?.message || 'Could not confirm your right-facing position. Please try again from the beginning.')
        setLivenessPrompt('Please try again from the beginning.')
        setLivenessProgress(0)
        return
      }

      setLivenessPrompt('Verifying…')
      setLivenessProgress(90)
      const res = await api.post(`/attempts/${attempt.id}/checklist/liveness`, {
        center_frame: center, left_frame: left.frame, right_frame: right.frame,
      })
      setLivenessProgress(100)
      setKeyStatus('liveness', res.liveness_ok ? 'passed' : 'failed')
      if (!res.liveness_ok) setKeyError('liveness', res.message)
      setLivenessPrompt(res.liveness_ok ? 'Liveness confirmed.' : res.message)
    } catch (e) {
      setKeyStatus('liveness', 'failed')
      setKeyError('liveness', apiErrorMessage(e))
    }
  }

  const enterExam = async () => {
    setEntering(true)
    setEnterError(null)
    try {
      await api.post(`/attempts/${attempt.id}/enter`)
      navigate(`/student/exam/${examId}`)
    } catch (e) {
      setEnterError(apiErrorMessage(e))
    } finally {
      setEntering(false)
    }
  }

  if (initializing) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-950">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        <p className="text-sm text-slate-500">Preparing your exam session…</p>
      </div>
    )
  }

  if (initError || !exam || !attempt) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-4 text-center dark:bg-slate-950">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{initError || 'Exam not found'}</p>
        <Link to="/student/dashboard" className="text-sm font-medium text-brand-600 hover:underline">Back to dashboard</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* */}
      <video ref={camVideoRef} autoPlay muted playsInline className="fixed left-[-9999px] top-0 h-32 w-48 opacity-0" />

      <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs text-slate-400">Pre-Exam Security Checklist</p>
          <h1 className="text-sm font-bold text-slate-900 dark:text-white">{exam.title}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <Stepper steps={STEPS.map((s) => s.label)} current={stepIndex} />

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          {currentKey === 'camera' && (
            <CheckStep
              icon={Camera}
              title="Camera Permission"
              instruction="We need access to your camera to verify your identity and monitor the exam session."
              status={currentStatus}
              error={stepError.camera}
              onAllow={allowCamera}
              buttonLabel="Allow Camera"
              successLabel="Camera Access Granted"
              preview={<LiveFeed type="face" stream={cameraStream} mirror connected={!!cameraStream} size="xl" />}
            />
          )}

          {currentKey === 'microphone' && (
            <CheckStep
              icon={Mic}
              title="Microphone Permission"
              instruction="Audio is monitored throughout the exam to detect unusual sound patterns."
              status={currentStatus}
              error={stepError.microphone}
              onAllow={allowMicrophone}
              buttonLabel="Allow Microphone"
              successLabel="Microphone Access Granted"
              preview={<AudioMeter stream={micStream} />}
            />
          )}

          {currentKey === 'screenShare' && (
            <CheckStep
              icon={MonitorUp}
              title="Screen Sharing"
              instruction="To maintain exam integrity, you must share your entire screen. Screen sharing must remain active for the whole exam."
              status={currentStatus}
              error={stepError.screenShare}
              onAllow={allowScreen}
              buttonLabel="Share Screen"
              successLabel="Screen Shared"
              preview={<LiveFeed type="screen" stream={screenStream} connected={!!screenStream} size="xl" />}
            />
          )}

          {currentKey === 'identity' && (
            <CheckStep
              icon={ScanFace}
              title="Identity Verification"
              instruction="We'll verify your face against your registered reference photo (from when you signed up). Make sure only you are visible, in good lighting."
              status={currentStatus}
              error={stepError.identity}
              onAllow={runIdentityEnroll}
              buttonLabel="Verify Identity"
              successLabel="Identity Verified"
              preview={
                <div>
                  <LiveFeed type="face" stream={cameraStream} mirror connected={!!cameraStream} size="xl" />
                  {currentStatus === 'checking' && (
                    <div className="mt-2"><ProgressBar value={captureProgress} /></div>
                  )}
                </div>
              }
            />
          )}

          {currentKey === 'liveness' && (
            <LivenessStep
              status={currentStatus}
              error={stepError.liveness}
              onStart={runLiveness}
              prompt={livenessPrompt}
              progress={livenessProgress}
              cameraStream={cameraStream}
            />
          )}

          {currentKey === 'ready' && (
            <SystemReady
              status={status}
              enterError={enterError}
              entering={entering}
              allPassed={allPassed}
              onEnter={enterExam}
              steps={STEPS}
            />
          )}
        </div>

        {currentKey !== 'ready' && (
          <div className="mt-5 flex items-center justify-between">
            <Button variant="ghost" icon={ArrowLeft} onClick={back} disabled={stepIndex === 0}>Back</Button>
            <Button iconRight={ArrowRight} onClick={next} disabled={currentStatus !== 'passed'}>
              {stepIndex === STEPS.length - 2 ? 'Continue to Summary' : 'Continue'}
            </Button>
          </div>
        )}
      </main>
    </div>
  )
}

function mediaErrorMessage(e, device) {
  if (e?.name === 'NotAllowedError') return `Permission denied. Please allow ${device} access in your browser and try again.`
  if (e?.name === 'NotFoundError') return `No ${device} device was found on this computer.`
  if (e?.name === 'NotReadableError') return `Your ${device} is already in use by another application.`
  return e?.message || `Could not access your ${device}.`
}

function apiErrorMessage(e) {
  if (e instanceof ApiError) return e.message
  return e?.message || 'Something went wrong. Please try again.'
}

function CheckStep({ icon: Icon, title, instruction, status, error, onAllow, buttonLabel, successLabel, preview }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{instruction}</p>
        </div>
      </div>

      <div className="mt-4">{preview}</div>

      <div className="mt-4">
        {status === 'pending' && <Button className="w-full" onClick={onAllow}>{buttonLabel}</Button>}
        {status === 'checking' && (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-slate-50 py-3 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking…
          </div>
        )}
        {status === 'passed' && (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 py-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> {successLabel}
          </div>
        )}
        {status === 'failed' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error || 'That check failed.'}
            </div>
            <Button className="w-full" variant="outline" icon={RotateCcw} onClick={onAllow}>Try Again</Button>
          </div>
        )}
      </div>
    </div>
  )
}

function AudioMeter({ stream }) {
  const [level, setLevel] = useState(new Array(24).fill(4))
  const rafRef = useRef(null)

  useEffect(() => {
    if (!stream) return
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 64
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      analyser.getByteFrequencyData(data)
      const bars = Array.from({ length: 24 }, (_, i) => {
        const v = data[Math.floor((i / 24) * data.length)] || 0
        return Math.max(6, (v / 255) * 100)
      })
      setLevel(bars)
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(rafRef.current)
      source.disconnect()
      ctx.close().catch(() => {})
    }
  }, [stream])

  const active = !!stream

  return (
    <div className="flex h-24 items-center justify-center gap-1 rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
      {level.map((h, i) => (
        <div
          key={i}
          className="w-1.5 rounded-full bg-brand-500 transition-all duration-100"
          style={{ height: `${active ? h : 8}%`, opacity: active ? 1 : 0.3 }}
        />
      ))}
    </div>
  )
}

function LivenessStep({ status, error, onStart, prompt, progress, cameraStream }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
          <Fingerprint className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Liveness Detection</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Follow the on-screen instruction to confirm you're a live participant, not a photo.</p>
        </div>
      </div>

      <div className="mt-4">
        <LiveFeed type="face" stream={cameraStream} mirror connected={!!cameraStream} size="xl" />
      </div>

      {status !== 'pending' && prompt && (
        <p className="mt-3 animate-fade-up text-center text-sm font-medium text-brand-700 dark:text-brand-400">
          {prompt}
        </p>
      )}

      <div className="mt-4">
        {status === 'pending' && <Button className="w-full" onClick={onStart}>Start Liveness Check</Button>}
        {status === 'checking' && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>Liveness Check</span>
              <span className="font-semibold tabular-nums">{progress}%</span>
            </div>
            <ProgressBar value={progress} />
          </div>
        )}
        {status === 'passed' && (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 py-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Liveness Verified
          </div>
        )}
        {status === 'failed' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
              <XCircle className="h-4 w-4 shrink-0" /> {error || 'Liveness check failed.'}
            </div>
            <Button className="w-full" variant="outline" icon={RotateCcw} onClick={onStart}>Try Again</Button>
          </div>
        )}
      </div>
    </div>
  )
}

function SystemReady({ status, enterError, entering, allPassed, onEnter, steps }) {
  const rows = steps.filter((s) => s.key !== 'ready').map((s) => ({ key: s.key, label: s.label }))
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">System Ready</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Review your checks before entering the exam.</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((r) => {
          const passed = status[r.key] === 'passed'
          return (
            <div key={r.key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-sm dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-300">{r.label}</span>
              {passed ? (
                <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Passed</span>
              ) : (
                <span className="text-slate-400">Pending</span>
              )}
            </div>
          )
        })}
      </div>

      {enterError && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{enterError}</p>
      )}

      <Button className="mt-5 w-full" size="lg" disabled={!allPassed || entering} onClick={onEnter}>
        {entering ? 'Starting…' : 'Enter Exam'}
      </Button>
      {!allPassed && <p className="mt-2 text-center text-xs text-slate-400">Complete every check above to unlock this button.</p>}
    </div>
  )
}