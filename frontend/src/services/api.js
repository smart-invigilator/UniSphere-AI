
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const API_BASE = `${API_URL}/api/v1`

const TOKEN_KEY = 'proctor.auth.tokens'

function getTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function setTokens(tokens) {
  if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
  else localStorage.removeItem(TOKEN_KEY)
}

let refreshPromise = null

async function doRefresh() {
  const tokens = getTokens()
  if (!tokens?.refresh_token) throw new Error('No refresh token')
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  })
  if (!res.ok) {
    setTokens(null)
    throw new Error('Session expired')
  }
  const data = await res.json()
  setTokens(data)
  return data
}

class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

function formatValidationMessage(detail) {
  if (typeof detail === 'string') return detail

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = item?.loc?.at(-1)
        const label = typeof field === 'string'
          ? field.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
          : 'This field'

        if (item?.type === 'string_too_short' && item?.ctx?.min_length) {
          return `${label} must be at least ${item.ctx.min_length} characters long.`
        }
        return item?.msg ? `${label}: ${item.msg}` : null
      })
      .filter(Boolean)
      .join(' ')
  }

  if (detail && typeof detail === 'object') {
    return detail.message || detail.error || null
  }

  return null
}

function getErrorMessage(detail, fallback) {
  return formatValidationMessage(detail) || fallback
}

async function request(path, { method = 'GET', body, auth = true, retry = true } = {}) {

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const headers = isForm ? {} : { 'Content-Type': 'application/json' }
  if (auth) {
    const tokens = getTokens()
    if (tokens?.access_token) headers.Authorization = `Bearer ${tokens.access_token}`
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && auth && retry) {
    try {
      refreshPromise = refreshPromise || doRefresh()
      await refreshPromise
      refreshPromise = null
      return request(path, { method, body, auth, retry: false })
    } catch {
      refreshPromise = null
    }
  }

  if (res.status === 204) return null

  let data = null
  try {
    data = await res.json()
  } catch {
    
  }

  if (!res.ok) {
    const message = getErrorMessage(data?.detail, res.statusText || 'Request failed')
    throw new ApiError(message, res.status, data)
  }
  return data
}

export const api = {
  get: (path) => request(path, { method: 'GET' }),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData }),

  async downloadFile(path, filename) {
    const tokens = getTokens()
    const res = await fetch(`${API_BASE}${path}`, {
      headers: tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {},
    })
    if (!res.ok) {
      let message = res.statusText || 'Download failed'
      try {
        const data = await res.json()
        message = getErrorMessage(data?.detail, message)
      } catch { /* no JSON body */ }
      throw new ApiError(message, res.status, null)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  register: (payload) => request('/auth/register', { method: 'POST', body: payload, auth: false }),

  getTokens,
  setTokens,
  isAuthenticated: () => !!getTokens()?.access_token,
}

export { API_URL, ApiError }