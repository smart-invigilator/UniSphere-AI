// Real Socket.IO client. Two thin wrappers share one underlying connection
// style but serve different roles:
//   - dashboardService: teacher's Live Monitoring page, scoped to one exam.
//   - studentStreamService: a student's own exam page, streams webcam/screen
//     frames up and receives back live metrics/alerts for their own view.
import { io } from 'socket.io-client'
import { API_URL } from './api'

class RoomService {
  constructor() {
    this.socket = null
    this.listeners = {}
  }

  on(event, cb) {
    ;(this.listeners[event] ||= []).push(cb)
    if (this.socket) this.socket.on(event, cb)
    return () => {
      this.listeners[event] = (this.listeners[event] || []).filter((f) => f !== cb)
      if (this.socket) this.socket.off(event, cb)
    }
  }

  _bindAll() {
    Object.entries(this.listeners).forEach(([event, cbs]) => {
      cbs.forEach((cb) => this.socket.on(event, cb))
    })
  }

  emit(event, payload) {
    this.socket?.emit(event, payload)
  }

  emitVolatile(event, payload) {
    if (this.socket?.connected) this.socket.volatile.emit(event, payload)
  }

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
    // NOTE: do NOT clear this.listeners here. Listeners registered via
    // on() (e.g. MonitorContext's one-time subscription on app load)
    // must survive a disconnect so they get re-bound by _bindAll() on the
    // next connect() — otherwise the very first reconnect silently drops
    // every handler and the UI stops receiving events forever.
  }
}

class DashboardService extends RoomService {
  connect(token, examId) {
    if (this.socket) this.disconnect()
    this.socket = io(API_URL, { path: '/socket.io', transports: ['websocket', 'polling'] })
    this._bindAll()
    this.socket.on('connect', () => {
      this.socket.emit('dashboard:join', { token, exam_id: examId }, (res) => {
        this.listeners['connected']?.forEach((cb) => cb(!!res?.ok))
      })
    })
    this.socket.on('disconnect', () => {
      this.listeners['connected']?.forEach((cb) => cb(false))
    })
  }
}

class StudentStreamService extends RoomService {
  connect(token, attemptId) {
    if (this.socket) this.disconnect()
    this.socket = io(API_URL, { path: '/socket.io', transports: ['websocket', 'polling'] })
    this._bindAll()
    return new Promise((resolve) => {
      this.socket.on('connect', () => {
        this.socket.emit('student:join', { token, attempt_id: attemptId }, (res) => {
          this.listeners['connected']?.forEach((cb) => cb(!!res?.ok))
          resolve(res)
        })
      })
      this.socket.on('disconnect', () => {
        this.listeners['connected']?.forEach((cb) => cb(false))
      })
    })
  }

  sendWebcamFrame(base64Jpeg) {
    this.emitVolatile('frame:webcam', { image: base64Jpeg })
  }

  // Reports a browser-detected violation (tab switch, fullscreen exit,
  // window blur, copy, paste — see CLIENT_VIOLATION_TYPES on the backend
  // for the whitelist). The server derives the actual alert type/severity
  // from `type` itself rather than trusting anything else from the client.
  reportViolation(type) {
    this.emit('client:violation', { type })
  }

  // Energy-based (RMS loudness) voice-activity level, 0-1. Sent roughly
  // once a second — see the honesty note in the backend's socket_server.py
  // about what this can and can't detect (sustained "sound is happening",
  // not real speech recognition or telling two voices apart).
  sendAudioLevel(level) {
    this.emitVolatile('audio:level', { level })
  }

  sendScreenFrame(base64Jpeg) {
    this.emitVolatile('frame:screen', { image: base64Jpeg })
  }

  heartbeat() {
    this.emit('heartbeat', {})
  }
}

export const dashboardService = new DashboardService()
export const studentStreamService = new StudentStreamService()