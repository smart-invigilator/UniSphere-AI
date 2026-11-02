import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAnswerSync } from '../answerSync'

function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }
}

function fakeServer() {
  const store = new Map()
  const calls = []
  let failNext = 0
  let failStatus = 0
  const post = vi.fn(async ({ question_id, response, client_seq }) => {
    calls.push({ question_id, response, client_seq })
    if (failNext > 0) {
      failNext -= 1
      const e = new Error('fail')
      e.status = failStatus
      throw e
    }
    const cur = store.get(question_id)
    if (cur && client_seq <= cur.client_seq) return { ...cur, stale: true }
    const next = { response, client_seq }
    store.set(question_id, next)
    return { ...next, stale: false }
  })
  return { post, store, calls, fail: (n, status = 0) => { failNext = n; failStatus = status } }
}

let t = 1_700_000_000_000
beforeEach(() => {
  vi.useFakeTimers()
  t = 1_700_000_000_000
})
afterEach(() => vi.useRealTimers())

describe('answer autosave engine', () => {
  it('debounces rapid edits and only sends the newest content', async () => {
    const srv = fakeServer()
    const statuses = []
    const sync = createAnswerSync({ attemptId: 1, post: srv.post, now: () => t, storage: memoryStorage(), onStatus: (q, s) => statuses.push(s) })
    for (let i = 0; i < 20; i += 1) sync.queue(5, `v${i}`, { delay: 500 })
    await vi.advanceTimersByTimeAsync(600)
    expect(srv.calls.length).toBe(1)
    expect(srv.store.get(5).response).toBe('v19')
    expect(sync.status(5)).toBe('saved')
    expect(statuses).toContain('saving')
  })

  it('never lets an older request overwrite newer content', async () => {
    let release
    const srv = fakeServer()
    const slowPost = vi.fn((p) => new Promise((res) => { release = () => res(srv.post(p)) }))
    const sync = createAnswerSync({ attemptId: 1, post: slowPost, now: () => t, storage: memoryStorage() })
    sync.queue(7, 'old', { delay: 0 })
    await vi.advanceTimersByTimeAsync(1)
    sync.queue(7, 'new', { delay: 0 })
    await vi.advanceTimersByTimeAsync(1)
    expect(slowPost).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(1)
    release()
    await vi.advanceTimersByTimeAsync(1)
    expect(srv.store.get(7).response).toBe('new')
    const seqs = slowPost.mock.calls.map((c) => c[0].client_seq)
    expect(seqs[1]).toBeGreaterThan(seqs[0])
  })

  it('sequence numbers stay monotonic across a page reload', async () => {
    const srv = fakeServer()
    const a = createAnswerSync({ attemptId: 1, post: srv.post, now: () => t, storage: memoryStorage() })
    a.queue(1, 'before reload', { delay: 0 })
    await vi.advanceTimersByTimeAsync(1)
    const saved = srv.store.get(1).client_seq
    const b = createAnswerSync({ attemptId: 1, post: srv.post, now: () => t - 60_000, storage: memoryStorage() })
    b.seed(1, saved)
    b.queue(1, 'after reload', { delay: 0 })
    await vi.advanceTimersByTimeAsync(1)
    expect(srv.store.get(1).response).toBe('after reload')
  })

  it('does not report saved on network failure, retries, then succeeds', async () => {
    const srv = fakeServer()
    const statuses = []
    const sync = createAnswerSync({ attemptId: 1, post: srv.post, now: () => t, storage: memoryStorage(), onStatus: (q, s) => statuses.push(s), retryDelays: [100, 200] })
    srv.fail(2, 0)
    sync.queue(3, 'answer', { delay: 0 })
    await vi.advanceTimersByTimeAsync(1)
    expect(sync.status(3)).toBe('retrying')
    expect(statuses).not.toContain('saved')
    await vi.advanceTimersByTimeAsync(100)
    expect(sync.status(3)).toBe('retrying')
    await vi.advanceTimersByTimeAsync(200)
    expect(sync.status(3)).toBe('saved')
    expect(srv.store.get(3).response).toBe('answer')
  })

  it('keeps newer edits made while offline and sends them after recovery', async () => {
    const srv = fakeServer()
    const sync = createAnswerSync({ attemptId: 1, post: srv.post, now: () => t, storage: memoryStorage(), retryDelays: [100] })
    srv.fail(1, 503)
    sync.queue(3, 'first', { delay: 0 })
    await vi.advanceTimersByTimeAsync(1)
    t += 5
    sync.queue(3, 'second', { delay: 0 })
    await vi.advanceTimersByTimeAsync(150)
    expect(srv.store.get(3).response).toBe('second')
  })

  it('stops retrying and reports rejected saves', async () => {
    const srv = fakeServer()
    const rejected = vi.fn()
    const sync = createAnswerSync({ attemptId: 1, post: srv.post, now: () => t, storage: memoryStorage(), onRejected: rejected })
    srv.fail(1, 400)
    sync.queue(4, 'x', { delay: 0 })
    await vi.advanceTimersByTimeAsync(1)
    expect(sync.status(4)).toBe('error')
    expect(rejected).toHaveBeenCalledTimes(1)
  })

  it('flush sends everything pending immediately and reports failures', async () => {
    const srv = fakeServer()
    const sync = createAnswerSync({ attemptId: 1, post: srv.post, now: () => t, storage: memoryStorage() })
    sync.queue(1, 'a', { delay: 99999 })
    sync.queue(2, 'b', { delay: 99999 })
    const res = await sync.flush()
    expect(res).toEqual({ ok: true, failed: [] })
    expect(srv.store.get(1).response).toBe('a')
    expect(srv.store.get(2).response).toBe('b')
    srv.fail(10, 0)
    sync.queue(1, 'c', { delay: 99999 })
    const res2 = await sync.flush({ attempts: 2 })
    expect(res2.ok).toBe(false)
    expect(res2.failed).toEqual([1])
  })

  it('recovers unsaved local work that is newer than the server copy', async () => {
    const storage = memoryStorage()
    const srv = fakeServer()
    srv.fail(5, 0)
    const a = createAnswerSync({ attemptId: 9, post: srv.post, now: () => t, storage })
    a.queue(2, 'typed offline', { delay: 0 })
    await vi.advanceTimersByTimeAsync(1)
    a.destroy()
    const b = createAnswerSync({ attemptId: 9, post: srv.post, now: () => t, storage })
    expect(b.recoverLocal(2, 0)).toBe('typed offline')
    expect(b.recoverLocal(2, Number.MAX_SAFE_INTEGER)).toBe(null)
    expect(b.recoverLocal(2, 0)).toBe(null)
  })
})