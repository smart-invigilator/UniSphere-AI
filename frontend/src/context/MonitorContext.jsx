import { createContext, useContext, useEffect, useReducer, useCallback, useState, useRef } from 'react'
import { dashboardService } from '../services/socket'
import { api } from '../services/api'

const MonitorContext = createContext(null)

const initial = {
  students: [],
  alerts: [],
  connected: false,
  loading: true,
  examId: null,
  frames: {}, 
}

function reducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return { ...initial, examId: action.examId, loading: true }
    case 'INIT_ALERTS':
      return { ...state, alerts: action.payload }
    case 'CONNECTED':
      return { ...state, connected: action.payload, loading: false }
    case 'INIT':
      return { ...state, students: action.payload, loading: false }
    case 'TICK': {
      const map = new Map(action.payload.map((s) => [s.id, s]))
      const merged = state.students.length
        ? state.students.map((s) => (map.has(s.id) ? { ...s, ...map.get(s.id) } : s))
        : action.payload
      const knownIds = new Set(merged.map((s) => s.id))
      const added = action.payload.filter((s) => !knownIds.has(s.id))
      return { ...state, students: [...merged, ...added] }
    }
    case 'ALERT': {
      const { alert, student } = action.payload
      const students = state.students.map((s) => (s.id === student.id ? { ...s, ...student } : s))
      return { ...state, students, alerts: [alert, ...state.alerts].slice(0, 200) }
    }
    case 'FRAME': {
      const { studentId, kind, image } = action.payload
      return {
        ...state,
        frames: { ...state.frames, [studentId]: { ...state.frames[studentId], [kind]: image } },
      }
    }
    case 'REVIEW_ALERT':
      return {
        ...state,
        alerts: state.alerts.map((a) => (a.id === action.id ? { ...a, reviewed: true } : a)),
      }
    case 'NOTE_ALERT':
      return {
        ...state,
        alerts: state.alerts.map((a) => (a.id === action.id ? { ...a, notes: action.notes } : a)),
      }
    default:
      return state
  }
}

export function MonitorProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initial)
  const [toasts, setToasts] = useState([])
  const activeExamRef = useRef(null)

  const pushToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { ...toast, id }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const connectExam = useCallback((examId) => {
    if (activeExamRef.current === examId) return
    activeExamRef.current = examId
    dispatch({ type: 'RESET', examId })
    const tokens = api.getTokens()
    dashboardService.connect(tokens?.access_token, examId)
    api.get(`/alerts/exam/${examId}`).then((rows) => {
      if (activeExamRef.current === examId) dispatch({ type: 'INIT_ALERTS', payload: rows })
    }).catch(() => {})
  }, [])

  const disconnectExam = useCallback(() => {
    activeExamRef.current = null
    dashboardService.disconnect()
  }, [])

  useEffect(() => {
    const offs = [
      dashboardService.on('connected', (v) => dispatch({ type: 'CONNECTED', payload: v })),
      dashboardService.on('students:init', (v) => dispatch({ type: 'INIT', payload: v })),
      dashboardService.on('students:tick', (v) => dispatch({ type: 'TICK', payload: v })),
      dashboardService.on('alert', (v) => {
        dispatch({ type: 'ALERT', payload: v })
        pushToast({
          title: v.student.name,
          message: v.alert.type,
          severity: v.alert.severity,
          studentId: v.student.id,
        })
      }),
      dashboardService.on('frame:webcam', (v) => dispatch({ type: 'FRAME', payload: { studentId: v.studentId, kind: 'webcam', image: v.image } })),
      dashboardService.on('frame:screen', (v) => dispatch({ type: 'FRAME', payload: { studentId: v.studentId, kind: 'screen', image: v.image } })),
    ]
    return () => offs.forEach((off) => off())
  }, [pushToast])

  const reviewAlert = useCallback((id) => dispatch({ type: 'REVIEW_ALERT', id }), [])
  const noteAlert = useCallback((id, notes) => dispatch({ type: 'NOTE_ALERT', id, notes }), [])

  return (
    <MonitorContext.Provider
      value={{ ...state, toasts, pushToast, dismissToast, reviewAlert, noteAlert, connectExam, disconnectExam }}
    >
      {children}
    </MonitorContext.Provider>
  )
}

export function useMonitor() {
  const ctx = useContext(MonitorContext)
  if (!ctx) throw new Error('useMonitor must be used within MonitorProvider')
  return ctx
}