import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { stopStream } from '../utils/media'

const ProctorSessionContext = createContext(null)

const STORAGE_KEY = 'proctor_session'

function loadStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      const { attemptId = null, examId = null } = JSON.parse(raw)
      return { attemptId, examId }
    }
  } catch { /* storage unavailable */ }
  return { attemptId: null, examId: null }
}

function saveStored(attemptId, examId) {
  try {
    if (attemptId == null) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ attemptId, examId }))
  } catch { /* storage unavailable */ }
}

// Lives at the App root (never unmounts on route change) so the camera,
// microphone, and screen-share permission grants obtained during the
// Pre-Exam Checklist survive the navigation into the actual exam page —
// browsers only let you request getDisplayMedia once per user gesture, so
// this is the only reliable way to keep the same screen-share track alive.
export function ProctorSessionProvider({ children }) {
  const [cameraStream, setCameraStream] = useState(null)
  const [micStream, setMicStream] = useState(null)
  const [screenStream, setScreenStream] = useState(null)
  // attemptId/examId are mirrored to sessionStorage so a browser refresh
  // (F5 / Ctrl+R) keeps the student on the exam page. MediaStreams can't
  // survive a reload, so the exam page offers the "Enable ..." recovery
  // buttons for whichever permissions were lost.
  const [attemptId, setAttemptIdState] = useState(() => loadStored().attemptId)
  const [examId, setExamIdState] = useState(() => loadStored().examId)
  const attemptRef = useRef(attemptId)

  const setAttempt = useCallback((id, exId) => {
    attemptRef.current = id
    setAttemptIdState(id)
    setExamIdState(exId)
    saveStored(id, exId)
  }, [])

  const stopAll = useCallback(() => {
    stopStream(cameraStream)
    stopStream(micStream)
    stopStream(screenStream)
    setCameraStream(null)
    setMicStream(null)
    setScreenStream(null)
    attemptRef.current = null
    setAttemptIdState(null)
    setExamIdState(null)
    saveStored(null, null)
  }, [cameraStream, micStream, screenStream])

  // Debounced variant for component-unmount cleanup. React StrictMode
  // (dev only) deliberately mounts every component, then immediately
  // unmounts and remounts it once, specifically to catch effects that
  // don't tolerate this. Calling stopAll() directly from an unmount
  // cleanup gets caught by exactly that: the synthetic unmount fires it
  // right after a genuine mount, wiping the whole session (streams +
  // attemptId) a moment after the page just loaded. Scheduling the stop
  // and letting the very next mount cancel it means: a real navigation
  // away (no remount follows) still releases the camera/mic/screen, but
  // StrictMode's synthetic cycle (mount -> cleanup -> mount, all
  // synchronous) cancels it before the timer ever fires.
  const stopTimerRef = useRef(null)

  const scheduleStopAll = useCallback((delayMs = 300) => {
    clearTimeout(stopTimerRef.current)
    stopTimerRef.current = setTimeout(() => stopAll(), delayMs)
  }, [stopAll])

  const cancelScheduledStop = useCallback(() => {
    clearTimeout(stopTimerRef.current)
    stopTimerRef.current = null
  }, [])

  return (
    <ProctorSessionContext.Provider
      value={{
        cameraStream, setCameraStream,
        micStream, setMicStream,
        screenStream, setScreenStream,
        attemptId, examId, setAttempt,
        stopAll, scheduleStopAll, cancelScheduledStop,
      }}
    >
      {children}
    </ProctorSessionContext.Provider>
  )
}

export function useProctorSession() {
  const ctx = useContext(ProctorSessionContext)
  if (!ctx) throw new Error('useProctorSession must be used within ProctorSessionProvider')
  return ctx
}