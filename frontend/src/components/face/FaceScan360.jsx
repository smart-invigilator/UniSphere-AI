import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, AlertTriangle, RotateCcw, ShieldCheck, Users } from 'lucide-react'
import { api } from '../../services/api'
import { waitForVideoReady } from '../../utils/media'
import Button from '../common/Button'

const FRAME_INTERVAL_MS = 250
const SEND_WIDTH = 480
const JPEG_QUALITY = 0.7
const MAX_NETWORK_RETRIES = 4

const C = 160
const R = 142
const HALF = 17 
const polar = (deg, r = R) => {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.cos(a), C - r * Math.sin(a)]
}
const arcPath = (k) => {
  const [x1, y1] = polar(45 * k - HALF)
  const [x2, y2] = polar(45 * k + HALF)
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

const PROBLEM_CODES = new Set(['multiple_faces', 'no_face', 'quality', 'face_lost', 'identity_check'])

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export default function FaceScan360({ purpose, scanToken = null, onPassed, onCancel = null }) {
  const [phase, setPhase] = useState('idle') 
  const [state, setState] = useState(null) 
  const [message, setMessage] = useState('')
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const runRef = useRef(0)                 

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => () => {
    runRef.current += 1
    stopCamera()
  }, [stopCamera])

  const grabFrame = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const canvas = canvasRef.current || (canvasRef.current = document.createElement('canvas'))
    canvas.width = SEND_WIDTH
    canvas.height = Math.round((SEND_WIDTH * v.videoHeight) / v.videoWidth)
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  }

  const fail = (text, nextPhase = 'error') => {
    runRef.current += 1
    stopCamera()
    setMessage(text)
    setPhase(nextPhase)
  }

  const start = async () => {
    const myRun = ++runRef.current
    setMessage('')
    setState(null)
    setPhase('starting')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      })
      if (runRef.current !== myRun) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
    } catch {
      fail('Camera access is required for the face scan. Allow the camera in your browser and try again.')
      return
    }

    for (let i = 0; i < 20 && !videoRef.current; i++) await sleep(50)
    const video = videoRef.current
    if (!video || runRef.current !== myRun) return
    video.srcObject = streamRef.current
    await waitForVideoReady(video)

    let session
    try {
      session = await api.faceScanStart(purpose, scanToken)
    } catch (e) {
      if (runRef.current === myRun) fail(e.message || 'Could not start the face scan.')
      return
    }
    if (runRef.current !== myRun) return
    setState(session.frame)
    setPhase('scanning')

    let retries = 0
    let last = session.frame
    while (runRef.current === myRun) {
      const began = performance.now()
      const image = grabFrame()
      if (image) {
        try {
          last = await api.faceScanFrame(session.session_id, image)
          retries = 0
          if (runRef.current !== myRun) return
          setState(last)
          if (last.status !== 'running') break
        } catch (e) {
          if (runRef.current !== myRun) return
          const fatal = [400, 401, 403, 404, 429, 503].includes(e.status)
          if (fatal || ++retries > MAX_NETWORK_RETRIES) {
            fail(e.status === 404 ? 'The scan session expired. Please start again.' : (e.message || 'Connection problem. Please try again.'))
            return
          }
        }
      }
      await sleep(Math.max(0, FRAME_INTERVAL_MS - (performance.now() - began)))
    }
    if (runRef.current !== myRun) return

    if (last.status === 'failed') {
      fail(last.message || 'The face scan did not pass.', 'failed')
      return
    }

    setPhase('finishing')
    try {
      const result = await api.faceScanComplete(session.session_id)
      if (runRef.current !== myRun) return
      stopCamera()
      onPassed(result)
    } catch (e) {
      if (runRef.current === myRun) fail(e.message || 'Could not finish the face scan. Please try again.')
    }
  }

  const cancel = () => {
    runRef.current += 1
    stopCamera()
    setPhase('idle')
    onCancel?.()
  }

  const steps = state?.steps || []
  const total = Math.max(steps.length, 1)
  const stepIndex = state?.step_index || 0
  const hold = state?.hold || { have: 0, need: 1 }
  const progress = phase === 'finishing' ? 1 : Math.min(1, (stepIndex + hold.have / Math.max(hold.need, 1)) / total)
  const done = new Set(state?.completed_sectors || [])
  const target = state?.target_sector
  const problem = state && PROBLEM_CODES.has(state.code) || state?.code?.startsWith('restart_')
  const multi = (state?.face_count || 0) > 1
  const camOn = phase === 'starting' || phase === 'scanning' || phase === 'finishing'

  const pose = state?.pose
  const dot = pose ? (() => {
    const mag = Math.hypot(pose.x, pose.y)
    const k = mag > 1.15 ? 1.15 / mag : 1
    return [C + pose.x * k * R, C - pose.y * k * R]
  })() : null

  if (phase === 'idle' || phase === 'failed' || phase === 'error') {
    return (
      <div className="space-y-3">
        {phase !== 'idle' && (
          <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{message}</span>
          </div>
        )}
        <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
          <li>• Sit in a well-lit place. <b>Only you</b> may be in view.</li>
          <li>• Look straight at the camera, then follow the highlighted part of the ring by slowly moving your head all the way around.</li>
          <li>• Keep your face visible the whole time. If another face appears, or you leave the view, the scan restarts.</li>
        </ul>
        <Button type="button" className="w-full" icon={phase === 'idle' ? Camera : RotateCcw} onClick={start}>
          {phase === 'idle' ? 'Start 360° face scan' : 'Try again'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" className="w-full" size="sm" onClick={cancel}>Cancel</Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-square w-full max-w-[320px]">
        <div className="absolute left-1/2 top-1/2 h-[76%] w-[76%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-slate-900">
          <video
            ref={videoRef}
            autoPlay muted playsInline
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}  
          />
        </div>
        <svg viewBox="0 0 320 320" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <circle cx={C} cy={C} r={R - 12} fill="none" className={multi ? 'stroke-rose-500' : 'stroke-slate-200 dark:stroke-slate-700'} strokeWidth={multi ? 3 : 1} />
          {Array.from({ length: 8 }, (_, k) => {
            const isDone = done.has(k)
            const isTarget = target === k
            const cls = isDone ? 'stroke-emerald-500' : isTarget ? 'stroke-brand-500 animate-pulse' : 'stroke-slate-300 dark:stroke-slate-700'
            return <path key={k} d={arcPath(k)} fill="none" strokeWidth={isTarget ? 16 : 12} strokeLinecap="round" className={cls} />
          })}
          {dot && <circle cx={dot[0]} cy={dot[1]} r="7" className="fill-white stroke-brand-600" strokeWidth="3" style={{ transition: 'cx 200ms, cy 200ms' }} />}
        </svg>
        {phase === 'finishing' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <CheckCircle2 className="h-16 w-16 text-emerald-500 drop-shadow" />
          </div>
        )}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className="h-full rounded-full bg-brand-600 transition-all duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      <p
        aria-live="polite"
        className={`flex min-h-[2.5rem] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-center text-sm font-semibold ${
          problem ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
            : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
        }`}
      >
        {multi && <Users className="h-4 w-4 shrink-0" />}
        {phase === 'starting' ? 'Starting camera…'
          : phase === 'finishing' ? 'Scan complete — finishing…'
            : state?.message || 'Look at the camera.'}
      </p>

      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Checked live on the server</span>
        <span>
          {state ? `Interruptions ${state.restarts}/${state.max_restarts} · ${state.seconds_left}s left` : ''}
        </span>
      </div>

      {phase === 'scanning' && (
        <Button type="button" variant="outline" className="w-full" size="sm" onClick={cancel}>Cancel scan</Button>
      )}
    </div>
  )
}
