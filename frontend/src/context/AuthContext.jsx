import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from '../services/api'

const AuthContext = createContext(null)
const USER_KEY = 'proctor.auth.user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(USER_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  }, [user])

  const applyTokens = async (data) => {
    api.setTokens(data)
    const me = await api.get('/auth/me')
    const nextUser = {
      id: me.id, name: me.name, email: me.email, role: me.role,
      studentId: me.student_id, department: me.department,
    }
    setUser(nextUser)
    return nextUser
  }

  const login = useCallback(async ({ email, password }) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.login(email, password)
      if (data.requires_face_scan) {
        return { requiresFaceScan: true, scanToken: data.scan_token, name: data.name, role: data.role }
      }
      return await applyTokens(data)
    } catch (e) {
      setError(e.message || 'Login failed')
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const finishFaceLogin = useCallback(async (tokens) => applyTokens(tokens), [])

  const register = useCallback(async ({ name, email, password, role, studentId, department, faceScanTicket }) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.register({
        name, email, password, role,
        student_id: studentId || null,
        department: department || null,
        face_scan_ticket: faceScanTicket || null,
      })
      return await applyTokens(data)
    } catch (e) {
      setError(e.message || 'Registration failed')
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    api.setTokens(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, login, finishFaceLogin, register, logout, loading, error, isAuthenticated: !!user }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
