import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  Clock, Camera, Mic, MonitorUp, ScanFace, Flag, ChevronLeft, ChevronRight,
  AlertTriangle, X, Send, Maximize2, Calculator as CalculatorIcon,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useProctorSession } from '../../context/ProctorSessionContext'
import { api, ApiError } from '../../services/api'
import { studentStreamService } from '../../services/socket'
import { captureFrame, waitForVideoReady } from '../../utils/media'
import Button from '../../components/common/Button'
import Modal from '../../components/common/Modal'
import LiveFeed from '../../components/LiveFeed'
import QuestionRenderer from '../../components/questions/QuestionRenderer'
import ScientificCalculator from '../../components/student/ScientificCalculator'
import { isAnswered, parseResponse, serializeResponse } from '../../utils/questionTypes'

const WEBCAM_FPS_MS = 500
const SCREEN_FPS_MS = 2000

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
    attemptId, stopAll, scheduleStopAll, cancelScheduledStop,
  } = useProctorSession()
  const navigate = useNavigate()

  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [answers, setAnswers] = useState({})
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
    if (!attemptId) {
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
        const restored = {}
        for (const r of saved) {
          const question = qs.find((x) => x.id === r.question_id)
          const value = question && parseResponse(question, r.response)
          if (question && isAnswered(question, value)) restored[question.id] = value
        }
        setAnswers(restored)
        if (a.status !== 'in_progress') {
          setLoadError('This attempt is not currently in progress.')
        } else if (a.started_at) {
          const elapsed = (Date.now() - new Date(a.started_at).getTime()) / 1000
          setSecondsLeft(Math.max(0, Math.round(e.duration_minutes * 60 - elapsed)))
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
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const track = stream.getVideoTracks()[0]
        const displaySurface = track?.getSettings?.().displaySurface
        if (displaySurface && displaySurface !== 'monitor') {
          track.stop()
          throw new Error('Please share your entire screen, not a single window or tab.')
        }
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
    const id = setInterval(() => {
      const frame = captureFrame(screenVideoRef.current, 0.5)
      if (frame) studentStreamService.sendScreenFrame(frame)
    }, SCREEN_FPS_MS)
    return () => clearInterval(id)
  }, [screenStream, connected])

  useEffect(() => {
    if (!connected) return
    const id = setInterval(() => studentStreamService.heartbeat(), 15000)
    return () => clearInterval(id)
  }, [connected])

  const q = questions[index]
  const answeredCount = useMemo(
    () => questions.filter((x) => isAnswered(x, answers[x.id])).length,
    [questions, answers],
  )
  const saveTimers = useRef({})
  const pendingAnswers = useRef({}) 

  const setAnswer = (val) => {
    if (!q) return
    setAnswers((a) => ({ ...a, [q.id]: val }))
    clearTimeout(saveTimers.current[q.id])
    pendingAnswers.current[q.id] = val
    saveTimers.current[q.id] = setTimeout(() => {
      delete pendingAnswers.current[q.id]
      api.post(`/attempts/${attemptId}/answer`, { question_id: q.id, response: serializeResponse(val) }).catch((err) => {
        if (err?.status === 400 && /time is up/i.test(err?.message || '')) {
          submit()
        }
      })
    }, 500)
  }

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
    try {
      const waiting = Object.entries(pendingAnswers.current)
      pendingAnswers.current = {}
      Object.values(saveTimers.current).forEach(clearTimeout)
      await Promise.all(waiting.map(([qid, val]) =>
        api.post(`/attempts/${attemptId}/answer`, { question_id: Number(qid), response: serializeResponse(val) }).catch(() => {})))
      const res = await api.post(`/attempts/${attemptId}/submit`)
      studentStreamService.disconnect()
      ignoreMediaEndRef.current = true
      stopAll()
      navigate('/student/exam-submitted', {
        state: {
          examTitle: exam?.title,
          answered: answeredCount,
          total: questions.length,
          autoScore: res.auto_score,
          totalMarks: res.total_marks,
          ungraded: res.ungraded_questions,
          attemptId,
        },
      })
    } catch (err) {
      setSubmitting(false)
      showBanner({ text: err instanceof ApiError ? err.message : 'Could not submit. Try again.', severity: 'high' })
    }
  }, [attemptId, submitting, exam, answeredCount, questions.length, stopAll])

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
  const recoveryActions = [
    { key: 'camera', label: 'Enable Camera', icon: Camera, missing: !cameraStream },
    { key: 'microphone', label: 'Enable Microphone', icon: Mic, missing: !micStream },
    { key: 'screenShare', label: 'Enable Screen Sharing', icon: MonitorUp, missing: !screenStream },
    { key: 'identity', label: 'Verify Identity', icon: ScanFace, missing: identityNeedsRecovery },
  ].filter((action) => action.missing)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <video ref={camVideoRef} autoPlay muted playsInline className="fixed left-[-9999px] top-0 h-2 w-2 opacity-0" />
      <video ref={screenVideoRef} autoPlay muted playsInline className="fixed left-[-9999px] top-0 h-2 w-2 opacity-0" />

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{exam.title}</p>
            <p className="text-xs text-slate-400">{user?.name} · {user?.studentId}</p>
          </div>
          <div className="flex items-center gap-4">
            <Button
              size="sm"
              variant={calcOpen ? 'danger' : 'outline'}
              icon={calcOpen ? X : CalculatorIcon}
              onClick={() => setCalcOpen((open) => !open)}
              aria-pressed={calcOpen}
            >
              {calcOpen ? 'Close Calculator' : 'Open Calculator'}
            </Button>
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
        {/* Question navigator */}
        <aside className="order-2 lg:order-1">
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Questions</p>
            <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-4">
              {questions.map((question, i) => {
                const state = i === index ? 'current' : isAnswered(question, answers[question.id]) ? 'answered' : marked.has(question.id) ? 'marked' : 'unanswered'
                const styles = {
                  current: 'bg-brand-600 text-white',
                  answered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
                  marked: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
                  unanswered: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                }
                return (
                  <button key={question.id} onClick={() => setIndex(i)} className={`rounded-md py-1.5 text-xs font-semibold ${styles[state]}`}>
                    {i + 1}
                  </button>
                )
              })}
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              <Legend color="bg-emerald-500" label="Answered" />
              <Legend color="bg-amber-500" label="Marked for review" />
              <Legend color="bg-slate-300 dark:bg-slate-600" label="Unanswered" />
            </div>
          </div>
        </aside>

        {/* Question area */}
        <section className="order-1 lg:order-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">Question {index + 1} of {questions.length}</span>
              <span className="text-xs text-slate-400">{q.marks} marks</span>
            </div>
            <QuestionRenderer key={q.id} q={q} value={answers[q.id]} onChange={setAnswer} />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="outline" icon={ChevronLeft} disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>Previous</Button>
              <Button variant="outline" iconRight={ChevronRight} disabled={index === questions.length - 1} onClick={() => setIndex((i) => i + 1)}>Next</Button>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" icon={Flag} onClick={toggleMark}>{marked.has(q.id) ? 'Unmark' : 'Mark for Review'}</Button>
              <Button variant="danger" icon={Send} onClick={() => setSubmitOpen(true)}>Submit Exam</Button>
            </div>
          </div>
        </section>

        {/* Proctoring panel */}
        <aside className="order-3">
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proctoring Status</p>
            <LiveFeed type="face" stream={cameraStream} mirror connected={!!cameraStream} size="sm" />
            <StatusRow icon={Camera} label="Camera" ok={!!cameraStream} />
            <StatusRow icon={Mic} label="Microphone" ok={!!micStream} />
            <StatusRow icon={MonitorUp} label="Screen Sharing" ok={!!screenStream} />
            <StatusRow
              icon={ScanFace}
              label="Identity"
              ok={identity.status === 'verified'}
              text={identityLabel(identity)}
            />
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
            <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{questions.length - answeredCount}</p>
            <p className="text-slate-500 dark:text-slate-400">Unanswered</p>
          </div>
          <div className="rounded-lg bg-brand-50 p-2.5 dark:bg-brand-500/10">
            <p className="text-lg font-bold text-brand-700 dark:text-brand-400">{mm}:{ss}</p>
            <p className="text-brand-600 dark:text-brand-400">Remaining</p>
          </div>
        </div>
      </Modal>

      <ScientificCalculator open={calcOpen} onClose={() => setCalcOpen(false)} />
    </div>
  )
}

function OptionRow({ label, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
        selected
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400'
          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300 dark:border-slate-600'}`}>
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      {label}
    </button>
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