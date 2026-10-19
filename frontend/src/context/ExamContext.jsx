import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from '../services/api'
import { useAuth } from './AuthContext'

const ExamContext = createContext(null)

export function ExamProvider({ children }) {
  const { user, isAuthenticated } = useAuth()
  const [courses, setCourses] = useState([])
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setCourses([])
      setExams([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const myCourses = await api.get('/courses/mine')
      setCourses(myCourses)
      if (user.role === 'teacher' || user.role === 'admin') {
        const lists = await Promise.all(
          myCourses.map((c) => api.get(`/exams/course/${c.id}`).catch(() => []))
        )
        setExams(lists.flat())
      } else {
        const mine = await api.get('/exams/mine').catch(() => [])
        setExams(mine)
      }
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, user])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createCourse = useCallback(async (payload) => {
    const c = await api.post('/courses', payload)
    await refresh()
    return c
  }, [refresh])

  const createExam = useCallback(async (payload) => {
    const e = await api.post('/exams', payload)
    await refresh()
    return e
  }, [refresh])

  const publishExam = useCallback(async (examId) => {
    const e = await api.post(`/exams/${examId}/publish`)
    await refresh()
    return e
  }, [refresh])

  const updateExam = useCallback(async (examId, payload) => {
    const e = await api.patch(`/exams/${examId}`, payload)
    await refresh()
    return e
  }, [refresh])

  const deleteExam = useCallback(async (examId) => {
    await api.delete(`/exams/${examId}`)
    await refresh()
  }, [refresh])

  const enrollByCode = useCallback(async (code) => {
    const c = await api.post('/courses/enroll', { code })
    await refresh()
    return c
  }, [refresh])

  const joinExamByCode = useCallback(async (code) => {
    return api.post('/exams/join', { code })
  }, [])

  const startAttempt = useCallback(async (examId) => {
    return api.post(`/exams/${examId}/start`)
  }, [])

  const findExam = useCallback((id) => exams.find((e) => String(e.id) === String(id)), [exams])

  return (
    <ExamContext.Provider
      value={{
        courses, exams, loading, refresh,
        createCourse, createExam, publishExam, updateExam, deleteExam,
        enrollByCode, joinExamByCode, startAttempt, findExam,
      }}
    >
      {children}
    </ExamContext.Provider>
  )
}

export function useExams() {
  const ctx = useContext(ExamContext)
  if (!ctx) throw new Error('useExams must be used within ExamProvider')
  return ctx
}