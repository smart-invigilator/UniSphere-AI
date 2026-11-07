// Central REST client. Reads the backend URL from Vite env (VITE_API_URL),
// falling back to localhost:8000 for local dev without Docker.
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
  const headers = { 'Content-Type': 'application/json' }
  if (auth) {
    const tokens = getTokens()
    if (tokens?.access_token) headers.Authorization = `Bearer ${tokens.access_token}`
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && auth && retry) {
    try {
      refreshPromise = refreshPromise || doRefresh()
      await refreshPromise
      refreshPromise = null
      return request(path, { method, body, auth, retry: false })
    } catch {
      refreshPromise = null
      // fall through to normal error handling below
    }
  }

  if (res.status === 204) return null

  let data = null
  try {
    data = await res.json()
  } catch {
    // no body
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

  // For binary responses (e.g. PDF reports) that the JSON-parsing request()
  // wrapper above can't handle — fetches with the auth header, then
  // triggers a normal browser file download.
  //
  // Fixes: (1) an expired access token (30 min) now gets refreshed and the
  // download retried, exactly like normal API calls — previously it just
  // failed with 401; (2) network/CORS failures (e.g. a backend 500) now
  // produce a readable error instead of an unhandled promise; (3) the
  // object URL is revoked after a delay — revoking it immediately after
  // click() cancels the download in some browsers.
  async downloadFile(path, filename, retry = true) {
    const tokens = getTokens()
    let res
    try {
      res = await fetch(`${API_BASE}${path}`, {
        headers: tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {},
      })
    } catch {
      throw new ApiError('Could not reach the server to generate the report. Check that the backend is running and see its console for errors.', 0, null)
    }

    if (res.status === 401 && retry) {
      try {
        refreshPromise = refreshPromise || doRefresh()
        await refreshPromise
        refreshPromise = null
        return api.downloadFile(path, filename, false)
      } catch {
        refreshPromise = null
        throw new ApiError('Your session has expired. Please log in again.', 401, null)
      }
    }

    if (!res.ok) {
      let message = res.statusText || 'Download failed'
      try {
        const data = await res.json()
        message = getErrorMessage(data?.detail, message)
      } catch { /* no JSON body */ }
      throw new ApiError(message, res.status, null)
    }

    const blob = await res.blob()
    if (!blob.size) throw new ApiError('The server returned an empty file.', res.status, null)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  },

  async upload(path, file, retry = true) {
    const tokens = getTokens()
    const form = new FormData()
    form.append('file', file)
    let res
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {},
        body: form,
      })
    } catch {
      throw new ApiError('Could not reach the server to upload the file.', 0, null)
    }
    if (res.status === 401 && retry) {
      try {
        refreshPromise = refreshPromise || doRefresh()
        await refreshPromise
        refreshPromise = null
        return api.upload(path, file, false)
      } catch {
        refreshPromise = null
        throw new ApiError('Your session has expired. Please log in again.', 401, null)
      }
    }
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (!res.ok) {
      throw new ApiError(getErrorMessage(data?.detail, res.statusText || 'Upload failed'), res.status, data)
    }
    return data
  },

  // Student answer files are private: the backend requires a valid access token.
  mediaUrl: (url) => {
    if (!url || !url.startsWith('/media/')) return ''
    if (url.startsWith('/media/answers/')) {
      const token = getTokens()?.access_token
      return token ? `${API_URL}${url}?access_token=${encodeURIComponent(token)}` : ''
    }
    return `${API_URL}${url}`
  },

  // Auth (no bearer token needed for these calls themselves)
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  register: (payload) => request('/auth/register', { method: 'POST', body: payload, auth: false }),
  loginFace: (faceToken, faceScan) => request('/auth/login/face', { method: 'POST', body: { face_token: faceToken, face_scan: faceScan }, auth: false }),
  checkScanFrame: (image) => request('/auth/face/scan-frame', { method: 'POST', body: { image }, auth: false }),

  getTokens,
  setTokens,
  isAuthenticated: () => !!getTokens()?.access_token,
}

export { API_URL, ApiError }