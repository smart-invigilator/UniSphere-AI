// Phone-as-camera: WebRTC link between the exam laptop (host) and the
// student's phone. The backend Socket.IO server only relays signaling
// (offer/answer/ICE); video flows peer-to-peer. The received MediaStream is
// handed to the exam as an ordinary camera stream, so frame capture, identity
// checks and the teacher's live view work unchanged.
import { io } from 'socket.io-client'
import { API_URL } from './api'

function parseIceServers() {
  try {
    const raw = import.meta.env.VITE_ICE_SERVERS
    if (raw) return JSON.parse(raw)
  } catch { /* fall through to default */ }
  return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
}

export const RTC_CONFIG = { iceServers: parseIceServers() }

// How long a dropped connection may stay down before the phone counts as lost.
const LOST_GRACE_MS = 6000

// The pairing link the QR code encodes. Everything the phone needs is in the
// URL: the pairing token and the backend it should signal through.
export function buildPairingUrl(pairToken, origin = window.location.origin) {
  const url = new URL(`/phone-camera/${encodeURIComponent(pairToken)}`, origin)
  if (API_URL) url.searchParams.set('api', API_URL)
  return url.toString()
}

export function isLocalhostUrl(value) {
  try {
    const { hostname } = new URL(value)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

function createSignalingSocket(apiUrl = API_URL) {
  return io(apiUrl, { path: '/socket.io', transports: ['websocket', 'polling'] })
}

// ---------------------------------------------------------------- laptop --
export class PhoneCameraHost {
  constructor() {
    this.socket = null
    this.pc = null
    this.listeners = {}
    this.pendingCandidates = []
    this.lostTimer = null
    this.stream = null
    this.state = 'idle' // idle | waiting | connecting | connected | lost
  }

  on(event, cb) {
    ;(this.listeners[event] ||= new Set()).add(cb)
    return () => this.listeners[event]?.delete(cb)
  }

  _emit(event, payload) {
    this.listeners[event]?.forEach((cb) => cb(payload))
  }

  _setState(state) {
    if (this.state === state) return
    this.state = state
    this._emit('state', state)
  }

  // Opens a signaling session for this attempt. Resolves with the pairing token.
  start(accessToken, attemptId) {
    this.stop()
    this._setState('waiting')
    this.socket = createSignalingSocket()
    return new Promise((resolve, reject) => {
      const socket = this.socket
      let settled = false
      const join = () => {
        socket.emit('phone:host', { token: accessToken, attempt_id: attemptId }, (res) => {
          if (!res?.ok) {
            if (!settled) { settled = true; reject(new Error(res?.error || 'Could not start phone pairing')) }
            return
          }
          this.pairToken = res.pair_token
          if (!settled) { settled = true; resolve(res.pair_token) }
          // After a reconnect, a phone that is still there needs a fresh call.
          if (res.phone_connected) this._beginCall()
        })
      }
      socket.on('connect', join)
      socket.on('connect_error', () => {
        if (!settled) { settled = true; reject(new Error('Could not reach the server')) }
      })
      socket.on('phone:peer', ({ connected }) => {
        if (connected) this._beginCall()
        else this._scheduleLost(LOST_GRACE_MS)
      })
      socket.on('phone:signal', ({ data }) => this._onSignal(data))
    })
  }

  async _beginCall() {
    this._closePeer()
    this._setState('connecting')
    const pc = new RTCPeerConnection(RTC_CONFIG)
    this.pc = pc
    this.pendingCandidates = []
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.onicecandidate = (e) => {
      if (e.candidate) this.socket?.emit('phone:signal', { data: { candidate: e.candidate.toJSON() } })
    }
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track])
      this.stream = stream
      this._emit('stream', stream)
    }
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return
      const s = pc.connectionState
      if (s === 'connected') {
        clearTimeout(this.lostTimer)
        this._setState('connected')
      } else if (s === 'disconnected') {
        this._scheduleLost(LOST_GRACE_MS)
      } else if (s === 'failed' || s === 'closed') {
        this._scheduleLost(0)
      }
    }
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.socket?.emit('phone:signal', { data: { description: pc.localDescription.toJSON() } })
    } catch {
      this._scheduleLost(0)
    }
  }

  async _onSignal(data) {
    const pc = this.pc
    if (!pc || !data) return
    try {
      if (data.description) {
        await pc.setRemoteDescription(data.description)
        for (const c of this.pendingCandidates) await pc.addIceCandidate(c)
        this.pendingCandidates = []
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate)
        else this.pendingCandidates.push(data.candidate)
      }
    } catch { /* stale signal for a replaced connection */ }
  }

  _scheduleLost(delay) {
    clearTimeout(this.lostTimer)
    this.lostTimer = setTimeout(() => {
      if (this.pc && this.pc.connectionState === 'connected') return
      this._markLost()
    }, delay)
  }

  _markLost() {
    const had = this.stream
    this._closePeer()
    this._setState('lost')
    if (had) this._emit('lost', had)
  }

  _closePeer() {
    clearTimeout(this.lostTimer)
    if (this.pc) {
      this.pc.onconnectionstatechange = null
      this.pc.close()
      this.pc = null
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }

  stop() {
    const had = this.stream
    this._closePeer()
    if (had) this._emit('stopped', had)
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
    this.pairToken = null
    this._setState('idle')
  }
}

export const phoneCameraHost = new PhoneCameraHost()

// ----------------------------------------------------------------- phone --
export class PhoneCameraClient {
  constructor(pairToken, apiUrl) {
    this.pairToken = pairToken
    this.apiUrl = apiUrl || API_URL
    this.listeners = {}
    this.pc = null
    this.socket = null
    this.localStream = null
    this.pendingCandidates = []
  }

  on(event, cb) {
    ;(this.listeners[event] ||= new Set()).add(cb)
    return () => this.listeners[event]?.delete(cb)
  }

  _emit(event, payload) {
    this.listeners[event]?.forEach((cb) => cb(payload))
  }

  // Must be called from a tap (user gesture): iOS Safari requires it for camera access.
  async openCamera(facingMode = 'user') {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error('This browser cannot access the camera. Open the link over HTTPS in Safari or Chrome.')
      err.name = 'NotSupportedError'
      throw err
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    })
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream = stream
    this._emit('local', stream)
    // Switching cameras mid-call: swap the track without renegotiating.
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video' || !s.track)
    const track = stream.getVideoTracks()[0]
    if (sender && track) await sender.replaceTrack(track)
    return stream
  }

  connect() {
    this.socket = createSignalingSocket(this.apiUrl)
    return new Promise((resolve, reject) => {
      const socket = this.socket
      let settled = false
      socket.on('connect', () => {
        socket.emit('phone:join', { pair_token: this.pairToken }, (res) => {
          if (!res?.ok) {
            if (!settled) { settled = true; reject(new Error(res?.error || 'Could not join the exam session')) }
            return
          }
          if (!settled) { settled = true; resolve() }
          this._emit('joined')
        })
      })
      socket.on('connect_error', () => {
        if (!settled) { settled = true; reject(new Error('Could not reach the exam server. Check your internet connection.')) }
      })
      socket.on('disconnect', () => this._emit('disconnected'))
      socket.on('phone:signal', ({ data }) => this._onSignal(data))
      socket.on('phone:host-left', () => this._emit('host-left'))
      socket.on('phone:replaced', () => this._emit('replaced'))
    })
  }

  async _onSignal(data) {
    if (!data) return
    try {
      if (data.description) {
        if (data.description.type === 'offer') await this._answer(data.description)
        else if (this.pc) await this.pc.setRemoteDescription(data.description)
      } else if (data.candidate) {
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(data.candidate)
        else this.pendingCandidates.push(data.candidate)
      }
    } catch { /* stale signal */ }
  }

  async _answer(offer) {
    this.pc?.close()
    const pc = new RTCPeerConnection(RTC_CONFIG)
    this.pc = pc
    this.pendingCandidates = []
    pc.onicecandidate = (e) => {
      if (e.candidate) this.socket?.emit('phone:signal', { data: { candidate: e.candidate.toJSON() } })
    }
    pc.onconnectionstatechange = () => this._emit('connection', pc.connectionState)
    await pc.setRemoteDescription(offer)
    const track = this.localStream?.getVideoTracks()[0]
    const transceiver = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video')
    if (track && transceiver) {
      transceiver.direction = 'sendonly'
      await transceiver.sender.replaceTrack(track)
    }
    for (const c of this.pendingCandidates) await pc.addIceCandidate(c)
    this.pendingCandidates = []
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    this.socket?.emit('phone:signal', { data: { description: pc.localDescription.toJSON() } })
  }

  close() {
    this.pc?.close()
    this.pc = null
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream = null
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }
  }
}
