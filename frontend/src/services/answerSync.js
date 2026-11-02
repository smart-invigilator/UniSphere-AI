const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000]

function defaultStorage() {
  try {
    const s = window.localStorage
    const probe = '__ae_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export function isRetryable(err) {
  const status = err?.status ?? 0
  return status === 0 || status === 408 || status === 429 || status >= 500
}

export function createAnswerSync({ attemptId, post, onStatus, onRejected, storage = defaultStorage(), now = () => Date.now(), retryDelays = RETRY_DELAYS }) {
  const items = new Map()
  let lastIssued = 0
  let destroyed = false
  const backupKey = (qid) => `ae:${attemptId}:${qid}`

  const item = (qid) => {
    if (!items.has(qid)) {
      items.set(qid, { pending: null, inflight: null, savedSeq: 0, status: 'idle', error: null, timer: null, retryTimer: null, retryIndex: 0 })
    }
    return items.get(qid)
  }

  const nextSeq = () => {
    lastIssued = Math.max(lastIssued + 1, Math.floor(now()) * 1000)
    return lastIssued
  }

  const setStatus = (qid, status, error = null) => {
    const it = item(qid)
    it.status = status
    it.error = error
    onStatus?.(qid, status, error)
  }

  const writeBackup = (qid, response, seq) => {
    if (!storage) return
    try {
      storage.setItem(backupKey(qid), JSON.stringify({ seq, response }))
    } catch {
      return
    }
  }

  const clearBackup = (qid, upToSeq) => {
    if (!storage) return
    try {
      const raw = storage.getItem(backupKey(qid))
      if (!raw) return
      const b = JSON.parse(raw)
      if (!b || b.seq <= upToSeq) storage.removeItem(backupKey(qid))
    } catch {
      storage.removeItem(backupKey(qid))
    }
  }

  const send = (qid) => {
    const it = item(qid)
    if (destroyed || it.inflight || !it.pending) return it.inflight
    clearTimeout(it.timer)
    clearTimeout(it.retryTimer)
    const payload = it.pending
    it.pending = null
    setStatus(qid, 'saving')
    it.inflight = Promise.resolve()
      .then(() => post({ question_id: qid, response: payload.response, client_seq: payload.seq }))
      .then((res) => {
        it.inflight = null
        it.retryIndex = 0
        const confirmed = Math.max(payload.seq, Number(res?.client_seq) || 0)
        it.savedSeq = Math.max(it.savedSeq, confirmed)
        lastIssued = Math.max(lastIssued, Number(res?.client_seq) || 0)
        clearBackup(qid, it.savedSeq)
        if (it.pending) {
          send(qid)
        } else {
          setStatus(qid, 'saved')
        }
      })
      .catch((err) => {
        it.inflight = null
        if (!it.pending) it.pending = payload
        if (isRetryable(err) && !destroyed) {
          const delay = retryDelays[Math.min(it.retryIndex, retryDelays.length - 1)]
          it.retryIndex += 1
          setStatus(qid, 'retrying', err)
          it.retryTimer = setTimeout(() => send(qid), delay)
        } else {
          setStatus(qid, 'error', err)
          onRejected?.(qid, err)
        }
      })
    return it.inflight
  }

  return {
    seed(qid, serverSeq) {
      const it = item(qid)
      it.savedSeq = Math.max(it.savedSeq, Number(serverSeq) || 0)
      lastIssued = Math.max(lastIssued, it.savedSeq)
    },

    recoverLocal(qid, serverSeq) {
      if (!storage) return null
      try {
        const raw = storage.getItem(backupKey(qid))
        if (!raw) return null
        const b = JSON.parse(raw)
        if (b && typeof b.response === 'string' && b.seq > (Number(serverSeq) || 0)) return b.response
        storage.removeItem(backupKey(qid))
      } catch {
        return null
      }
      return null
    },

    queue(qid, response, { delay = 800 } = {}) {
      if (destroyed) return
      const it = item(qid)
      const seq = nextSeq()
      it.pending = { response, seq }
      writeBackup(qid, response, seq)
      if (it.status !== 'retrying') setStatus(qid, 'unsaved')
      clearTimeout(it.timer)
      if (it.status === 'retrying') return
      it.timer = setTimeout(() => send(qid), delay)
    },

    saveNow(qid) {
      return send(qid)
    },

    async flush({ attempts = 3 } = {}) {
      for (let round = 0; round < attempts; round += 1) {
        const work = []
        for (const [qid, it] of items) {
          clearTimeout(it.timer)
          clearTimeout(it.retryTimer)
          if (it.inflight) work.push(it.inflight.catch(() => {}))
          else if (it.pending) work.push((send(qid) || Promise.resolve()).catch(() => {}))
        }
        await Promise.all(work)
        await Promise.all([...items.values()].map((it) => it.inflight?.catch(() => {})))
        const failed = [...items.entries()].filter(([, it]) => it.pending || it.inflight).map(([qid]) => qid)
        if (!failed.length) return { ok: true, failed: [] }
      }
      const failed = [...items.entries()].filter(([, it]) => it.pending || it.inflight).map(([qid]) => qid)
      return { ok: failed.length === 0, failed }
    },

    status(qid) {
      return items.get(qid)?.status || 'idle'
    },

    hasUnsaved() {
      return [...items.values()].some((it) => it.pending || it.inflight)
    },

    discardBackups(qids) {
      if (!storage) return
      qids.forEach((qid) => {
        try {
          storage.removeItem(backupKey(qid))
        } catch {
          return
        }
      })
    },

    destroy() {
      destroyed = true
      for (const it of items.values()) {
        clearTimeout(it.timer)
        clearTimeout(it.retryTimer)
      }
    },
  }
}