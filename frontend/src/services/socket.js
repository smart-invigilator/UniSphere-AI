
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

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
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
    this.emit('frame:webcam', { image: base64Jpeg })
  }
  reportViolation(type) {
    this.emit('client:violation', { type })
  }
  sendAudioLevel(level) {
    this.emit('audio:level', { level })
  }

  sendScreenFrame(base64Jpeg) {
    this.emit('frame:screen', { image: base64Jpeg })
  }

  heartbeat() {
    this.emit('heartbeat', {})
  }
}

export const dashboardService = new DashboardService()
export const studentStreamService = new StudentStreamService()