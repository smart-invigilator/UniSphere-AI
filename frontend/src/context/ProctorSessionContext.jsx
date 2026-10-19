import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { stopStream } from '../utils/media'

const ProctorSessionContext = createContext(null)
export function ProctorSessionProvider({ children }) {
  const [cameraStream, setCameraStream] = useState(null)
  const [micStream, setMicStream] = useState(null)
  const [screenStream, setScreenStream] = useState(null)
  const [attemptId, setAttemptIdState] = useState(null)
  const [examId, setExamIdState] = useState(null)
  const attemptRef = useRef(null)

  const setAttempt = useCallback((id, exId) => {
    attemptRef.current = id
    setAttemptIdState(id)
    setExamIdState(exId)
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
  }, [cameraStream, micStream, screenStream])
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