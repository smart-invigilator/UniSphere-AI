import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, Loader2, RotateCcw, ScanFace, ArrowLeft, ArrowRight, Circle, Check } from 'lucide-react'
import { api } from '../../services/api'
import Button from '../common/Button'

const TICK_MS = 200
const MAX_PER_LABEL = 2
const MIN_GAP_MS = 350
const CHECK_WIDTH = 320
const STORE_WIDTH = 480
const FINISH_WINDOW_MS = 2500
const TIPS_AFTER_MS = 15000
const FRONT_MAX_YAW = 10
// A side only counts once the head is turned at least this far (degrees).
// Slight turns (10–22°) are still captured for the gallery but no longer
// complete the step — the student has to look clearly over their shoulder.
const REQUIRED_TURN_YAW = 30
const GAUGE_RANGE = 45
const SMOOTHING = 0.35
const FAST_TURN_DEG = 14

// Labels that can complete a side. left_25/right_25 (slight turns) are
// deliberately excluded.
const GROUPS = {
  front: ['front'],
  left: ['left_45', 'left_65', 'profile_left'],
  right: ['right_45', 'right_65', 'profile_right'],
}

const STEPS = [
  { id: 'front', label: 'Look straight' },
  { id: 'left', label: 'Turn left' },
  { id: 'right', label: 'Turn right' },
]

const INSTRUCTIONS = {
  front: { title: 'Look straight at the camera', detail: 'Keep your face inside the oval and hold still.' },
  left: { title: 'Turn your head FAR to your LEFT', detail: 'Keep turning until the marker reaches the end of the left zone.' },
  right: { title: 'Now turn your head FAR to your RIGHT', detail: 'Keep turning until the marker reaches the end of the right zone.' },
  finishing: { title: 'All angles captured!', detail: 'Finishing your scan…' },
}

const FRONT_HALF = (FRONT_MAX_YAW / GAUGE_RANGE) * 50
const TURN_HALF = (REQUIRED_TURN_YAW / GAUGE_RANGE) * 50
// The coloured target zones start only at REQUIRED_TURN_YAW, so the gap
// between "Front" and each side shows how much further the head must turn.
const ZONES = [
  { id: 'left', label: 'Your left', from: 0, to: 50 - TURN_HALF },
  { id: 'front', label: 'Front', from: 50 - FRONT_HALF, to: 50 + FRONT_HALF },
  { id: 'right', label: 'Your right', from: 50 + TURN_HALF, to: 100 },
]

function grab(video, canvas, width, quality) {
  if (!video || !video.videoWidth) return null
  const scale = Math.min(1, width / video.videoWidth)
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality).split(',')[1]
}

const sideOf = (label) => (label?.startsWith('left') || label === 'profile_left' ? 'left' : label?.startsWith('right') || label === 'profile_right' ? 'right' : label === 'front' ? 'front' : null)
const has = (caps, labels) => labels.some((l) => (caps[l] || []).length > 0)
const groupsDone = (caps) => ({ front: has(caps, GROUPS.front), left: has(caps, GROUPS.left), right: has(caps, GROUPS.right) })
const yawToPct = (yaw) => 50 - (Math.max(-GAUGE_RANGE, Math.min(GAUGE_RANGE, yaw)) / GAUGE_RANGE) * 50

function nextStage(done) {
  if (!done.front) return 'front'
  if (!done.left) return 'left'
  if (!done.right) return 'right'
  return 'finishing'
}

function AngleGauge({ done, stage, pct, visible }) {
  return (
    <div className="select-none" data-testid="angle-gauge">
      <div className="relative h-4 w-full overflow-visible rounded-full bg-slate-200 dark:bg-slate-700">
        {ZONES.map((z) => {
          const filled = done[z.id]
          const target = stage === z.id
          return (
            <div
              key={z.id}
              data-testid={`zone-${z.id}`}
              data-done={filled ? 'true' : 'false'}
              className={`absolute inset-y-0 transition-colors duration-500 ${
                z.id === 'left' ? 'rounded-l-full' : z.id === 'right' ? 'rounded-r-full' : ''
              } ${filled ? 'bg-emerald-500' : target ? 'animate-pulse bg-brand-200 dark:bg-brand-500/40' : 'bg-slate-200 dark:bg-slate-700'}`}
              style={{ left: `${z.from}%`, width: `${z.to - z.from}%` }}
            />
          )
        })}
        <div className="absolute inset-y-0 w-0.5 bg-white/80 dark:bg-slate-900/80" style={{ left: `${ZONES[1].from}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-white/80 dark:bg-slate-900/80" style={{ left: `${ZONES[1].to}%` }} />
        <span
          data-testid="angle-marker"
          aria-hidden="true"
          className="absolute top-1/2 z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-brand-600 shadow-md dark:border-slate-900"
          style={{
            left: `${pct}%`,
            opacity: visible ? 1 : 0.25,
            transition: 'left 260ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 300ms ease',
          }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 text-[11px] font-semibold">
        {ZONES.map((z) => (
          <span
            key={z.id}
            className={`flex items-center gap-1 ${z.id === 'left' ? 'justify-start' : z.id === 'right' ? 'justify-end' : 'justify-center'} ${
              done[z.id] ? 'text-emerald-600 dark:text-emerald-400' : stage === z.id ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400'
            }`}
          >
            {done[z.id] ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
            {z.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function StepGuide({ done, stage }) {
  return (
    <ol className="flex items-center gap-1.5 text-[11px]" aria-label="Scan steps">
      {STEPS.map((s, i) => {
        const complete = done[s.id]
        const active = stage === s.id
        return (
          <li key={s.id} className="flex flex-1 items-center gap-1.5">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                complete ? 'bg-emerald-500 text-white' : active ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
              }`}
            >
              {complete ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={`font-medium ${complete ? 'text-emerald-600 dark:text-emerald-400' : active ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />}
          </li>
        )
      })}
    </ol>
  )
}

export default function FaceScan360({ title = 'Face Scan', description, onComplete, onCancel, busy = false, autoStart = false }) {
  const videoRef = useRef(null)
  const checkCanvasRef = useRef(null)
  const storeCanvasRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const inFlightRef = useRef(false)
  const capturesRef = useRef({})
  const lastCaptureRef = useRef({})
  const lastSideRef = useRef(null)
  const startedAtRef = useRef(0)
  const minimumAtRef = useRef(0)
  const finishedRef = useRef(false)
  const smoothYawRef = useRef(null)
  const rawYawRef = useRef(null)
  const onCompleteRef = useRef(onComplete)

  const [status, setStatus] = useState('idle')
  const [captured, setCaptured] = useState({})
  const [feedback, setFeedback] = useState('')
  const [faceOk, setFaceOk] = useState(false)
  const [markerPct, setMarkerPct] = useState(50)
  const [error, setError] = useState('')
  const [showTips, setShowTips] = useState(false)
  const [frontPreview, setFrontPreview] = useState(null)
  const [finishProgress, setFinishProgress] = useState(0)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const stopCamera = useCallback(() => {
    clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  const finish = useCallback(() => {
    if (finishedRef.current) return
    const done = groupsDone(capturesRef.current)
    if (!done.front || !done.left || !done.right) return
    finishedRef.current = true
    stopCamera()
    const frames = []
    Object.entries(capturesRef.current).forEach(([label, images]) => images.forEach((image) => frames.push({ label, image })))
    const front = capturesRef.current.front?.[0] || null
    setFrontPreview(front)
    setStatus('done')
    onCompleteRef.current?.({ frames, frontImage: front })
  }, [stopCamera])

  const store = (label, image) => {
    const list = capturesRef.current[label] || []
    const now = Date.now()
    if (list.length >= MAX_PER_LABEL || now - (lastCaptureRef.current[label] || 0) < MIN_GAP_MS) return false
    capturesRef.current = { ...capturesRef.current, [label]: [...list, image] }
    lastCaptureRef.current[label] = now
    setCaptured(Object.fromEntries(Object.entries(capturesRef.current).map(([k, v]) => [k, v.length])))
    return true
  }

  const moveMarker = (res) => {
    if (res.kind === 'profile') {
      const side = lastSideRef.current === 'right' ? 'right' : 'left'
      smoothYawRef.current = side === 'left' ? GAUGE_RANGE : -GAUGE_RANGE
      setMarkerPct(side === 'left' ? 2 : 98)
      return false
    }
    if (res.yaw == null) return false
    const raw = res.yaw
    const prevRaw = rawYawRef.current
    rawYawRef.current = raw
    const s = smoothYawRef.current
    const next = s == null ? raw : s + SMOOTHING * (raw - s)
    smoothYawRef.current = next
    setMarkerPct(yawToPct(next))
    return prevRaw != null && Math.abs(raw - prevRaw) > FAST_TURN_DEG
  }

  const tick = useCallback(async () => {
    if (inFlightRef.current || finishedRef.current) return
    const done = groupsDone(capturesRef.current)
    if (done.front && done.left && done.right) {
      if (!minimumAtRef.current) minimumAtRef.current = Date.now()
      const elapsed = Date.now() - minimumAtRef.current
      setFinishProgress(Math.min(1, elapsed / FINISH_WINDOW_MS))
      if (elapsed >= FINISH_WINDOW_MS) {
        finish()
        return
      }
    }
    if (Date.now() - startedAtRef.current > TIPS_AFTER_MS) setShowTips(true)

    const video = videoRef.current
    const check = grab(video, checkCanvasRef.current, CHECK_WIDTH, 0.7)
    const full = grab(video, storeCanvasRef.current, STORE_WIDTH, 0.85)
    if (!check || !full) return
    inFlightRef.current = true
    try {
      const res = await api.checkScanFrame(check)
      if (finishedRef.current) return
      setFaceOk(!!res.ok)
      if (!res.ok) {
        setFeedback(res.message || '')
        return
      }
      let label = res.label
      if (res.kind === 'profile') {
        const side = lastSideRef.current || (nextStage(groupsDone(capturesRef.current)) === 'right' ? 'right' : 'left')
        lastSideRef.current = side
        label = `profile_${side}`
      } else {
        const side = sideOf(label)
        if (side === 'left' || side === 'right') {
          lastSideRef.current = side
          // Not turned far enough yet: keep the frame (the server re-labels
          // mesh frames from their yaw anyway) but file it as a slight turn so
          // it can't complete the side.
          if (res.yaw != null && Math.abs(res.yaw) < REQUIRED_TURN_YAW) label = `${side}_25`
        }
      }
      const tooFast = moveMarker(res)
      const before = groupsDone(capturesRef.current)
      store(label, full)
      const after = groupsDone(capturesRef.current)
      const stage = nextStage(after)
      const newlyDone = ['front', 'left', 'right'].find((g) => !before[g] && after[g])
      if (newlyDone) {
        setFeedback(newlyDone === 'front' ? 'Front captured ✓' : `${newlyDone === 'left' ? 'Left' : 'Right'} side captured ✓`)
      } else if (tooFast && stage !== 'finishing') {
        setFeedback('Turn a little slower so each angle is captured.')
      } else if (stage === 'front') {
        setFeedback('Hold still…')
      } else if (stage === 'finishing') {
        setFeedback('')
      } else {
        const side = sideOf(label)
        if (side && side !== 'front' && side !== stage) setFeedback(`That's your ${side} — now turn to your ${stage.toUpperCase()}.`)
        else if (side === stage) setFeedback('Good — turn a bit further…')
        else setFeedback('Keep turning slowly…')
      }
    } catch (e) {
      if (e?.status === 503) {
        stopCamera()
        setStatus('error')
        setError(e.message)
      }
    } finally {
      inFlightRef.current = false
    }
  }, [finish, stopCamera])

  const start = useCallback(async () => {
    setError('')
    capturesRef.current = {}
    lastCaptureRef.current = {}
    lastSideRef.current = null
    minimumAtRef.current = 0
    finishedRef.current = false
    smoothYawRef.current = null
    rawYawRef.current = null
    setCaptured({})
    setFaceOk(false)
    setMarkerPct(50)
    setFeedback('')
    setShowTips(false)
    setFrontPreview(null)
    setFinishProgress(0)
    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      startedAtRef.current = Date.now()
      setStatus('scanning')
    } catch (e) {
      setStatus('error')
      setError(e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access and try again.' : 'Could not open your camera.')
    }
  }, [])

  useEffect(() => {
    if (status !== 'scanning') return undefined
    timerRef.current = setInterval(tick, TICK_MS)
    return () => clearInterval(timerRef.current)
  }, [status, tick])

  useEffect(() => {
    if (autoStart) start()
  }, [])

  const restart = () => {
    stopCamera()
    start()
  }

  const done = {
    front: GROUPS.front.some((l) => captured[l]),
    left: GROUPS.left.some((l) => captured[l]),
    right: GROUPS.right.some((l) => captured[l]),
  }
  const stage = nextStage(done)
  const allDone = stage === 'finishing'
  const inst = INSTRUCTIONS[stage]

  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" data-testid="face-scan">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <ScanFace className="h-4 w-4 text-brand-600" /> {title}
        </p>
      </div>
      {description && status !== 'done' && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{description}</p>}

      <div className={status === 'scanning' || status === 'starting' ? 'block' : 'hidden'}>
        <div className="mb-3">
          <StepGuide done={done} stage={stage} />
        </div>

        <div className="relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-900">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={`aspect-[3/4] h-[72%] rounded-[50%] border-4 transition-colors duration-300 ${allDone ? 'border-emerald-400' : faceOk ? 'border-emerald-300' : 'border-white/60'}`}
              style={{ boxShadow: '0 0 0 9999px rgba(15,23,42,0.4)' }}
            />
          </div>
          {status === 'scanning' && (stage === 'left' || stage === 'right') && (
            <div className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${stage === 'left' ? 'left-3' : 'right-3'}`}>
              <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-brand-600/80 text-white shadow-lg">
                {stage === 'left' ? <ArrowLeft className="h-7 w-7" /> : <ArrowRight className="h-7 w-7" />}
              </span>
            </div>
          )}
          {status === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          {status === 'scanning' && (
            <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-slate-950/80 to-transparent p-3 text-center text-white" aria-live="polite">
              <p className="text-sm font-bold" data-testid="scan-instruction">{inst.title}</p>
              <p className="text-[11px] text-slate-200">{inst.detail}</p>
            </div>
          )}
          {status === 'scanning' && feedback && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 to-transparent p-3 text-center text-xs font-medium text-amber-200" data-testid="scan-feedback">
              {feedback}
            </div>
          )}
          {status === 'scanning' && allDone && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
              <div className="h-full bg-emerald-400" style={{ width: `${finishProgress * 100}%`, transition: `width ${TICK_MS}ms linear` }} />
            </div>
          )}
        </div>

        <div className="mt-4">
          <AngleGauge done={done} stage={stage} pct={markerPct} visible={faceOk} />
        </div>

        {showTips && !allDone && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Tips: face a window or lamp so your face is evenly lit, sit about an arm’s length from the camera, and turn your head slowly — like looking over your shoulder.
          </p>
        )}

        <div className="mt-3 flex gap-2">
          {allDone && (
            <Button type="button" size="sm" className="w-full" icon={CheckCircle2} onClick={finish}>
              Finish now
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="w-full" icon={RotateCcw} onClick={restart}>
            Restart
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { stopCamera(); setStatus('idle'); onCancel() }}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {status === 'idle' && (
        <div className="space-y-2">
          <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
            <li className="flex gap-1.5"><Circle className="mt-0.5 h-2.5 w-2.5 shrink-0" /> Takes about 10 seconds.</li>
            <li className="flex gap-1.5"><Circle className="mt-0.5 h-2.5 w-2.5 shrink-0" /> Look straight, then turn your head well to the left, then well to the right (like looking over your shoulder). A marker shows your head direction.</li>
            <li className="flex gap-1.5"><Circle className="mt-0.5 h-2.5 w-2.5 shrink-0" /> Good light, only you in view, no hat, mask or sunglasses.</li>
          </ul>
          <Button type="button" className="w-full" size="sm" icon={Camera} onClick={start}>
            Start Face Scan
          </Button>
        </div>
      )}

      {status === 'done' && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            {frontPreview && (
              <img src={`data:image/jpeg;base64,${frontPreview}`} alt="Your face scan" className="h-14 w-14 rounded-lg object-cover" style={{ transform: 'scaleX(-1)' }} />
            )}
            <p className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {busy ? 'Verifying your scan…' : 'Scan complete — front, left and right captured'}
            </p>
          </div>
          {!busy && (
            <Button type="button" variant="outline" size="sm" className="w-full" icon={RotateCcw} onClick={restart}>
              Scan again
            </Button>
          )}
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-2">
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>
          <Button type="button" variant="outline" size="sm" className="w-full" icon={RotateCcw} onClick={start}>
            Try again
          </Button>
        </div>
      )}

      <canvas ref={checkCanvasRef} className="hidden" />
      <canvas ref={storeCanvasRef} className="hidden" />
    </div>
  )
}