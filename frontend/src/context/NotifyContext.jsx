import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

// useNotify() returns a stable object (safe in hook dependency arrays).
// App-wide feedback toasts ("Login successful", "Course created", errors...).
// Separate from the AI-proctoring alerts in MonitorContext.
const NotifyContext = createContext(null)
const NotifyItemsContext = createContext({ items: [], dismiss: () => {} })

const DURATION_MS = 2000
const MAX_VISIBLE = 4

export function NotifyProvider({ children }) {
  const [items, setItems] = useState([])
  const timers = useRef(new Map())
  const nextId = useRef(1)

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setItems((list) => list.filter((n) => n.id !== id))
  }, [])

  const push = useCallback((type, message, title) => {
    if (!message) return null
    const id = nextId.current++
    setItems((list) => [...list, { id, type, message: String(message), title }].slice(-MAX_VISIBLE))
    timers.current.set(id, setTimeout(() => dismiss(id), DURATION_MS))
    return id
  }, [dismiss])

  const api = useMemo(() => ({
    success: (message, title) => push('success', message, title),
    error: (message, title) => push('error', message, title),
    info: (message, title) => push('info', message, title),
    warning: (message, title) => push('warning', message, title),
    dismiss,
  }), [push, dismiss])

  return (
    <NotifyContext.Provider value={api}>
      <NotifyItemsContext.Provider value={{ items, dismiss }}>
        {children}
      </NotifyItemsContext.Provider>
    </NotifyContext.Provider>
  )
}

export function useNotify() {
  const ctx = useContext(NotifyContext)
  if (!ctx) throw new Error('useNotify must be used within NotifyProvider')
  return ctx
}

// For the toast renderer only.
export function useNotifyItems() {
  return useContext(NotifyItemsContext)
}
