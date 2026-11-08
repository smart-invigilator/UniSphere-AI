import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  Clock, Camera, Mic, MonitorUp, ScanFace, Flag, ChevronLeft, ChevronRight,
  AlertTriangle, X, Send, Maximize2, Calculator, Info,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useProctorSession } from '../../context/ProctorSessionContext'
import { api, ApiError } from '../../services/api'
import { studentStreamService } from '../../services/socket'
import { captureFrame, waitForVideoReady, requestEntireScreen } from '../../utils/media'
import Button from '../../components/common/Button'
import Modal from '../../components/common/Modal'
import LiveFeed from '../../components/LiveFeed'
import QuestionRenderer from '../../components/questions/QuestionRenderer'
import { SaveStatus } from '../../components/answer-editor/UnifiedAnswerEditor'
import { createAnswerSync } from '../../services/answerSync'
import { isAnswerable, isAnswered, parseResponse, serializeResponse } from '../../components/questions/questionTypes'

const ScientificCalculator = lazy(() => import('../../components/calculator/ScientificCalculator'))

const WEBCAM_FPS_MS = 500
const SCREEN_FPS_MS = 2000
const SCREEN_MAX_WIDTH = 1600
const SCREEN_RESEND_UNCHANGED_MS = 10000

const CONFIDENTIAL_ALERT_TYPES = new Set([
  'Different Person Detected',
  'Face Covered',
  'Face Obstructed',
])

export default function ExamPage() {
  const { examId } = useParams()
  const { user } = useAuth()
  const {
    cameraStream, setCameraStream,
    screenStream, setScreenStream,
    micStream, setMicStream,
    attemptId, examId: storedExamId, stopAll, scheduleStopAll, cancelScheduledStop,
  } = useProctorSession()
  const navigate = useNavigate()

  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [answers, setAnswers] = useState({})
  const [saveStates, setSaveStates] = useState({})
  const submitRef = useRef(null)
  const syncRef = useRef(null)
  const getSync = () => {
    if (!syncRef.current && attemptId) {
      syncRef.current = createAnswerSync({
        attemptId,
        post: (payload) => api.post(`/attempts/${attemptId}/answer`, payload),
        onStatus: (qid, status, error) => setSaveStates((st) => ({ ...st, [qid]: { status, error } })),
        onRejected: (_qid, err) => {
          if (/time is up/i.test(err?.message || '')) submitRef.current?.()
        },
      })
    }
    return syncRef.current
  }
  const [marked, setMarked] = useState(() => new Set())
  const [index, setIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(null)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState(null)
  const [calcOpen, setCalcOpen] = useState(false)
  const bannerTimeout = useRef(null)

  const [myStudentId, setMyStudentId] = useState(null)
  const myStudentIdRef = useRef(null)
  const [identity, setIdentity] = useState({ status: 'unavailable', similarity: null })
  const [identityNeedsRecovery, setIdentityNeedsRecovery] = useState(false)
  const [permissionRecovery, setPermissionRecovery] = useState({})
  const [connected, setConnected] = useState(false)
  const [fullscreenActive, setFullscreenActive] = useState(() => !!document.fullscreenElement)
  const everEnteredFullscreenRef = useRef(!!document.fullscreenElement)

  const camVideoRef = useRef(null)
  const screenVideoRef = useRef(null)
  const ignoreMediaEndRef = useRef(false)

  useEffect(() => {
    if (!attemptId || (storedExamId != null && String(storedExamId) !== String(examId))) {
      navigate(`/student/checklist/${examId}`, { replace: true })
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [e, qs, a, saved] = await Promise.all([
          api.get(`/exams/${examId}`),
          api.get(`/exams/${examId}/questions`),
          api.get(`/attempts/${attemptId}`),
          api.get(`/attempts/${attemptId}/answers`).catch(() => []),
        ])
        if (cancelled) return
        setExam(e)
        setQuestions(qs)
        const savedById = Object.fromEntries((saved || []).map((row) => [row.question_id, row]))
        const restored = {}
        let recovered = 0
        const sync = getSync()
        qs.forEach((question) => {
          if (!isAnswerable(question.type)) return
          const row = savedById[question.id]
          const serverSeq = row?.client_seq || 0
          sync?.seed(question.id, serverSeq)
          const local = a.status === 'in_progress' ? sync?.recoverLocal(question.id, serverSeq) : null
          const raw = local ?? row?.response
          const value = parseResponse(question.type, raw, question.settings)
          if (value !== undefined) restored[question.id] = value
          if (local !== null && local !== undefined) {
            recovered += 1
            sync.queue(question.id, local, { delay: 0 })
          }
        })
        setAnswers(restored)
        if (recovered) showBanner({ text: `Recovered ${recovered} unsaved answer${recovered > 1 ? 's' : ''} from this device — saving now.`, severity: 'low' })
        if (a.status !== 'in_progress') {
          setLoadError('This attempt is not currently in progress.')
        } else if (a.started_at) {
          const elapsed = (Date.now() - new Date(a.started_at).getTime()) / 1000
          let left = e.duration_minutes * 60 - elapsed
          if (e.scheduled_end) {
            left = Math.min(left, (new Date(e.scheduled_end).getTime() - Date.now()) / 1000)
          }
          setSecondsLeft(Math.max(0, Math.round(left)))
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Could not load the exam')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [examId, attemptId])

  useEffect(() => {
    if (secondsLeft === null) return
    const id = setInterval(() => setSecondsLeft((s) => (s === null ? s : Math.max(0, s - 1))), 1000)
    return () => clearInterval(id)
  }, [secondsLeft === null])

  useEffect(() => {
    if (secondsLeft === 0) submit()
  }, [secondsLeft])

  useEffect(() => {
    if (!attemptId) return
    const tokens = api.getTokens()
    let mounted = true
    studentStreamService.connect(tokens?.access_token, attemptId).then((res) => {
      if (mounted && res?.ok) {
        myStudentIdRef.current = res.studentId
        setMyStudentId(res.studentId)
      }
    })

    const offs = [
      studentStreamService.on('connected', (v) => setConnected(v)),
      studentStreamService.on('alert', (payload) => {
        if (!payload?.student || payload.student.id !== myStudentIdRef.current) return
        if (CONFIDENTIAL_ALERT_TYPES.has(payload.alert.type)) return
        showBanner({ text: payload.alert.type, severity: payload.alert.severity })
      }),
      studentStreamService.on('students:tick', (list) => {
        const mine = list.find((s) => s.id === myStudentIdRef.current)
        if (mine?.identity) {
          setIdentity(mine.identity)
          setIdentityNeedsRecovery(['mismatch', 'unavailable'].includes(mine.identity.status))
        }
      }),
    ]
    return () => {
      mounted = false
      offs.forEach((off) => off())
      studentStreamService.disconnect()
    }
  }, [attemptId])

  const showBanner = (b) => {
    setBanner(b)
    clearTimeout(bannerTimeout.current)
    bannerTimeout.current = setTimeout(() => setBanner(null), 6000)
  }

  const reportViolation = (type, label, severity = 'medium') => {
    showBanner({ text: label, severity })
    studentStreamService.reportViolation(type)
  }

  useEffect(() => {
    const watchedTracks = [
      [cameraStream?.getVideoTracks()[0], 'camera_stopped', 'Camera was stopped', setCameraStream],
      [micStream?.getAudioTracks()[0], 'microphone_stopped', 'Microphone was stopped', setMicStream],
      [screenStream?.getVideoTracks()[0], 'screen_share_stopped', 'Screen sharing was stopped', setScreenStream],
    ]
    const cleanups = watchedTracks
      .filter(([track]) => track)
      .map(([track, type, label, clearStream]) => {
        const onEnded = () => {
          if (ignoreMediaEndRef.current) return
          clearStream(null)
          reportViolation(type, label, 'high')
        }
        track.addEventListener('ended', onEnded)
        return () => track.removeEventListener('ended', onEnded)
      })

    return () => cleanups.forEach((cleanup) => cleanup())
  }, [cameraStream, micStream, screenStream])

  const recoverPermission = async (key) => {
    setPermissionRecovery((current) => ({ ...current, [key]: { checking: true, error: null } }))
    try {
      if (key === 'camera') {
        setCameraStream(await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } }))
        await api.post(`/attempts/${attemptId}/checklist/camera`)
      } else if (key === 'microphone') {
        setMicStream(await navigator.mediaDevices.getUserMedia({ audio: true }))
        await api.post(`/attempts/${attemptId}/checklist/microphone`)
      } else if (key === 'screenShare') {
        const stream = await requestEntireScreen()
        setScreenStream(stream)
        await api.post(`/attempts/${attemptId}/checklist/screen`)
      } else if (key === 'identity') {
        if (!cameraStream) throw new Error('Enable the camera first, then verify your identity.')
        const ready = await waitForVideoReady(camVideoRef.current, 4000)
        if (!ready) throw new Error('Camera feed is not ready yet. Please try again.')
        const frames = []
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          const frame = captureFrame(camVideoRef.current, 0.85)
          if (frame) frames.push(frame)
        }
        if (!frames.length) throw new Error('Could not capture your face. Please try again.')
        const result = await api.post(`/attempts/${attemptId}/checklist/enroll-face`, { frames })
        setIdentity({ status: result.identity_verified ? 'verified' : 'mismatch', similarity: null })
        setIdentityNeedsRecovery(!result.identity_verified)
      }
      setPermissionRecovery((current) => ({ ...current, [key]: { checking: false, error: null } }))
    } catch (error) {
      setPermissionRecovery((current) => ({
        ...current,
        [key]: { checking: false, error: mediaErrorMessage(error, key === 'screenShare' ? 'screen sharing' : key) },
      }))
    }
  }

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) reportViolation('tab_switch', 'Tab switched or window minimized', 'medium')
    }
    const onBlur = () => {
      reportViolation('window_blur', 'Browser window lost focus', 'medium')
    }
    const onCopy = () => reportViolation('copy', 'Copy detected', 'medium')
    const onPaste = () => reportViolation('paste', 'Paste detected', 'medium')
    const onFullscreenChange = () => {
      const isFs = !!document.fullscreenElement
      setFullscreenActive(isFs)
      if (!isFs && everEnteredFullscreenRef.current) {
        reportViolation('fullscreen_exit', 'Exited fullscreen mode', 'high')
      }
      if (isFs) everEnteredFullscreenRef.current = true
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    document.addEventListener('fullscreenchange', onFullscreenChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  useEffect(() => {
    if (!('getScreenDetails' in window)) return
    let cancelled = false
    ;(async () => {
      try {
        const status = await navigator.permissions.query({ name: 'window-management' })
        if (cancelled || status.state !== 'granted') return
        const details = await window.getScreenDetails()
        if (!cancelled && details.screens.length > 1) {
          reportViolation('multiple_displays', `${details.screens.length} displays detected`, 'medium')
        }
      } catch {
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!micStream || !connected) return
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return
    let raf
    let stopped = false
    const ctx = new AudioContextClass()
    const source = ctx.createMediaStreamSource(micStream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.1
    source.connect(analyser)
    const data = new Float32Array(analyser.fftSize)

    let lastSent = 0
    const tick = () => {
      if (stopped) return
      analyser.getFloatTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < data.length; i++) {
        sumSquares += data[i] * data[i]
      }
      const rms = Math.sqrt(sumSquares / data.length)
      const now = performance.now()
      if (now - lastSent > 1000) {
        lastSent = now
        studentStreamService.sendAudioLevel(rms)
      }
      raf = requestAnimationFrame(tick)
    }
    ctx.resume().then(() => {
      if (!stopped) tick()
    }).catch(() => {})

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      source.disconnect()
      ctx.close().catch(() => {})
    }
  }, [micStream, connected])

  useEffect(() => {
    cancelScheduledStop()
    return () => scheduleStopAll(300)
  }, [])

  useEffect(() => {
    if (camVideoRef.current) camVideoRef.current.srcObject = cameraStream || null
  }, [cameraStream, loading])
  useEffect(() => {
    if (screenVideoRef.current) screenVideoRef.current.srcObject = screenStream || null
  }, [screenStream, loading])

  useEffect(() => {
    if (!cameraStream || !connected) return
    const id = setInterval(() => {
      const frame = captureFrame(camVideoRef.current, 0.6)
      if (frame) studentStreamService.sendWebcamFrame(frame)
    }, WEBCAM_FPS_MS)
    return () => clearInterval(id)
  }, [cameraStream, connected])

  useEffect(() => {
    if (!screenStream || !connected) return
    let lastFrame = null
    let lastSentAt = 0
    const id = setInterval(() => {
      const frame = captureFrame(screenVideoRef.current, 0.5, SCREEN_MAX_WIDTH)
      if (!frame) return
      const now = Date.now()
      if (frame === lastFrame && now - lastSentAt < SCREEN_RESEND_UNCHANGED_MS) return
      lastFrame = frame
      lastSentAt = now
      studentStreamService.sendScreenFrame(frame)
    }, SCREEN_FPS_MS)
    return () => clearInterval(id)
  }, [screenStream, connected])

  useEffect(() => {
    if (!connected) return
    const id = setInterval(() => studentStreamService.heartbeat(), 15000)
    return () => clearInterval(id)
  }, [connected])

  const q = questions[index]
  const answerableQuestions = useMemo(() => questions.filter((question) => isAnswerable(question.type)), [questions])
  const answeredCount = useMemo(
    () => answerableQuestions.filter((question) => isAnswered(question.type, answers[question.id])).length,
    [answerableQuestions, answers],
  )
  const saveAnswer = (question, val) => {
    if (!question || !isAnswerable(question.type) || submitting) return
    setAnswers((a) => ({ ...a, [question.id]: val }))
    const delay = question.type === 'file_upload' || question.type === 'hotspot'
      ? 0
      : question.type === 'short' || question.type === 'essay' ? 1200 : 600
    getSync()?.queue(question.id, serializeResponse(question.type, val), { delay })
  }

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (syncRef.current?.hasUnsaved()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  useEffect(() => () => {
    const sync = syncRef.current
    syncRef.current = null
    if (sync) sync.flush({ attempts: 1 }).finally(() => sync.destroy())
  }, [])

  const toggleMark = () => {
    if (!q) return
    setMarked((m) => {
      const next = new Set(m)
      next.has(q.id) ? next.delete(q.id) : next.add(q.id)
      return next
    })
  }

  const submit = useCallback(async () => {
    if (!attemptId || submitting) return
    setSubmitting(true)
    setSubmitOpen(false)
    setCalcOpen(false)
    try {
      const flushed = await (getSync()?.flush() ?? Promise.resolve({ ok: true, failed: [] }))
      if (!flushed.ok && secondsLeft !== 0) {
        setSubmitting(false)
        showBanner({
          text: `${flushed.failed.length} answer${flushed.failed.length > 1 ? 's have' : ' has'} not reached the server yet. Check your connection and press Submit again — your work is kept on this device.`,
          severity: 'high',
        })
        return
      }
      const res = await api.post(`/attempts/${attemptId}/submit`)
      getSync()?.discardBackups(questions.map((question) => question.id))
      studentStreamService.disconnect()
      ignoreMediaEndRef.current = true
      stopAll()
      navigate('/student/exam-submitted', {
        state: {
          examTitle: exam?.title,
          answered: answeredCount,
          total: answerableQuestions.length,
          autoScore: res.auto_score,
          totalMarks: res.total_marks,
          ungraded: res.ungraded_questions,
          attemptId,
          timeUp: secondsLeft === 0,
        },
      })
    } catch (err) {
      setSubmitting(false)
      showBanner({ text: err instanceof ApiError ? err.message : 'Could not submit. Try again.', severity: 'high' })
    }
  }, [attemptId, submitting, exam, answeredCount, answerableQuestions.length, stopAll, secondsLeft, questions])

  useEffect(() => {
    submitRef.current = submit
  }, [submit])

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400 dark:bg-slate-950">Loading exam…</div>
  }

  if (loadError || !exam || !q) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-4 text-center dark:bg-slate-950">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{loadError || 'This exam has no questions yet.'}</p>
        <Link to="/student/dashboard" className="text-sm font-medium text-brand-600 hover:underline">Back to dashboard</Link>
      </div>
    )
  }

  const mm = String(Math.floor((secondsLeft || 0) / 60)).padStart(2, '0')
  const ss = String((secondsLeft || 0) % 60).padStart(2, '0')
  // Only what the teacher enabled for this exam is requested/shown.
  const sec = exam.security || {}
  const requires = (k) => sec[k] !== false
  const recoveryActions = [
    { key: 'camera', label: 'Enable Camera', icon: Camera, missing: requires('camera') && !cameraStream },
    { key: 'microphone', label: 'Enable Microphone', icon: Mic, missing: requires('microphone') && !micStream },
    { key: 'screenShare', label: 'Enable Screen Sharing', icon: MonitorUp, missing: requires('screenShare') && !screenStream },
    { key: 'identity', label: 'Verify Identity', icon: ScanFace, missing: requires('identity') && requires('camera') && identityNeedsRecovery },
  ].filter((action) => action.missing)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <video ref={camVideoRef} autoPlay muted playsInline className="fixed left-[-9999px] top-0 h-2 w-2 opacity-0" />
      <video ref={screenVideoRef} autoPlay muted playsInline className="fixed left-[-9999px] top-0 h-2 w-2 opacity-0" />

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{exam.title}</p>
            <p className="text-xs text-slate-400">{user?.name} · {user?.studentId}</p>
          </div>
          <div className="flex items-center gap-4">
            {exam.security?.calculator !== false && (
              <Button
                size="sm"
                variant={calcOpen ? 'primary' : 'outline'}
                icon={Calculator}
                onClick={() => setCalcOpen((o) => !o)}
                aria-pressed={calcOpen}
              >
                {calcOpen ? 'Close Calculator' : 'Open Calculator'}
              </Button>
            )}
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${connected ? 'text-emerald-600' : 'text-amber-600'}`}>
              <span className={`h-2 w-2 animate-pulse rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {connected ? 'Secure Session Active' : 'Connecting…'}
            </span>
            <span className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Clock className="h-4 w-4" /> {mm}:{ss}
            </span>
          </div>
        </div>
        <div className="h-1 bg-slate-100 dark:bg-slate-800">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
        </div>
      </header>

      {banner && (
        <div className="mx-auto mt-3 max-w-[1400px] px-4">
          <div className="flex animate-slide-in items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
            <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Warning — {banner.text}</span>
            <button onClick={() => setBanner(null)}><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}

      {!fullscreenActive && (
        <div className="mx-auto mt-3 max-w-[1400px] px-4">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400">
            <span className="flex items-center gap-1.5"><Maximize2 className="h-3.5 w-3.5" /> This exam should be taken in fullscreen mode.</span>
            <Button size="sm" variant="secondary" icon={Maximize2} onClick={enterFullscreen}>Go Fullscreen</Button>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 py-5 lg:grid-cols-[220px_1fr_260px]">
        <aside className="order-2 lg:order-1">
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Questions</p>
            <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-4">
              {questions.map((question, i) => {
                const state = i === index
                  ? 'current'
                  : !isAnswerable(question.type)
                    ? 'info'
                    : isAnswered(question.type, answers[question.id])
                      ? 'answered'
                      : marked.has(question.id) ? 'marked' : 'unanswered'
                const styles = {
                  current: 'bg-brand-600 text-white',
                  info: 'bg-sky-50 text-sky-600 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/30',
                  answered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
                  marked: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
                  unanswered: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                }
                return (
                  <button key={question.id} onClick={() => setIndex(i)} title={isAnswerable(question.type) ? undefined : 'Information'} className={`rounded-md py-1.5 text-xs font-semibold ${styles[state]}`}>
                    {isAnswerable(question.type) ? i + 1 : <Info className="mx-auto h-3.5 w-3.5" />}
                  </button>
                )
              })}
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              <Legend color="bg-emerald-500" label="Answered" />
              <Legend color="bg-amber-500" label="Marked for review" />
              <Legend color="bg-slate-300 dark:bg-slate-600" label="Unanswered" />
              {questions.some((question) => !isAnswerable(question.type)) && <Legend color="bg-sky-400" label="Information" />}
            </div>
          </div>
        </aside>

        <section className="order-1 lg:order-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                {isAnswerable(q.type) ? `Question ${index + 1} of ${questions.length}` : 'Information'}
              </span>
              <span className="flex items-center gap-3">
                {isAnswerable(q.type) && q.type !== 'short' && q.type !== 'essay' && (
                  <SaveStatus status={saveStates[q.id]?.status} error={saveStates[q.id]?.error} />
                )}
                {isAnswerable(q.type) && <span className="text-xs text-slate-400">{q.marks} marks</span>}
              </span>
            </div>
            <QuestionRenderer
              key={q.id}
              question={q}
              value={answers[q.id]}
              onChange={(val) => saveAnswer(q, val)}
              attemptId={attemptId}
              disabled={submitting || secondsLeft === 0}
              saveStatus={saveStates[q.id]?.status || 'idle'}
              saveError={saveStates[q.id]?.error}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="outline" icon={ChevronLeft} disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>Previous</Button>
              <Button variant="outline" iconRight={ChevronRight} disabled={index === questions.length - 1} onClick={() => setIndex((i) => i + 1)}>Next</Button>
            </div>
            <div className="flex gap-2">
              {isAnswerable(q.type) && (
                <Button variant="secondary" icon={Flag} onClick={toggleMark}>{marked.has(q.id) ? 'Unmark' : 'Mark for Review'}</Button>
              )}
              <Button variant="danger" icon={Send} onClick={() => setSubmitOpen(true)}>Submit Exam</Button>
            </div>
          </div>
        </section>

        <aside className="order-3">
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proctoring Status</p>
            {requires('camera') && <LiveFeed type="face" stream={cameraStream} mirror connected={!!cameraStream} size="sm" />}
            {requires('camera') && <StatusRow icon={Camera} label="Camera" ok={!!cameraStream} />}
            {requires('microphone') && <StatusRow icon={Mic} label="Microphone" ok={!!micStream} />}
            {requires('screenShare') && <StatusRow icon={MonitorUp} label="Screen Sharing" ok={!!screenStream} />}
            {requires('identity') && requires('camera') && (
              <StatusRow
                icon={ScanFace}
                label="Identity"
                ok={identity.status === 'verified'}
                text={identityLabel(identity)}
              />
            )}
            {recoveryActions.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                {recoveryActions.map(({ key, label, icon: Icon }) => {
                  const recovery = permissionRecovery[key] || {}
                  return (
                    <div key={key}>
                      <Button
                        className="w-full"
                        size="sm"
                        variant="outline"
                        icon={Icon}
                        onClick={() => recoverPermission(key)}
                        disabled={recovery.checking}
                      >
                        {recovery.checking ? 'Requesting…' : label}
                      </Button>
                      {recovery.error && <p className="mt-1 text-[11px] leading-snug text-rose-600">{recovery.error}</p>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </aside>
      </main>

      <Modal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title="Submit your exam?"
        footer={
          <>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>Keep Working</Button>
            <Button variant="danger" onClick={submit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Exam'}</Button>
          </>
        }
      >
        <p className="text-sm text-slate-500 dark:text-slate-400">Are you sure you want to submit your exam? This can't be undone.</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-emerald-50 p-2.5 dark:bg-emerald-500/10">
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{answeredCount}</p>
            <p className="text-emerald-600 dark:text-emerald-400">Answered</p>
          </div>
          <div className="rounded-lg bg-slate-100 p-2.5 dark:bg-slate-800">
            <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{answerableQuestions.length - answeredCount}</p>
            <p className="text-slate-500 dark:text-slate-400">Unanswered</p>
          </div>
          <div className="rounded-lg bg-brand-50 p-2.5 dark:bg-brand-500/10">
            <p className="text-lg font-bold text-brand-700 dark:text-brand-400">{mm}:{ss}</p>
            <p className="text-brand-600 dark:text-brand-400">Remaining</p>
          </div>
        </div>
      </Modal>

      {calcOpen && (
        <Suspense fallback={null}>
          <ScientificCalculator open={calcOpen} onClose={() => setCalcOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

function identityLabel(identity) {
  switch (identity?.status) {
    case 'verified':
      return identity.similarity != null ? `Verified · ${Math.round(identity.similarity * 100)}%` : 'Verified'
    case 'mismatch':
      return 'Mismatch!'
    case 'no_face':
      return 'Face not visible'
    case 'obstructed':
      return 'Face covered'
    case 'verifying':
      return 'Verifying…'
    default:
      return 'Monitoring…'
  }
}

function StatusRow({ icon: Icon, label, ok, text = 'Active' }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><Icon className="h-3.5 w-3.5" /> {label}</span>
      <span className={`flex items-center gap-1 font-semibold ${ok ? 'text-emerald-600' : 'text-rose-600'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} /> {text}
      </span>
    </div>
  )
}

function mediaErrorMessage(error, device) {
  if (error?.name === 'NotAllowedError') return `Permission denied. Please allow ${device} access and try again.`
  if (error?.name === 'NotFoundError') return `No ${device} device was found on this computer.`
  if (error?.name === 'NotReadableError') return `Your ${device} is already in use by another application.`
  return error?.message || `Could not access your ${device}.`
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} /> {label}
    </div>
  )
}