import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Room, RoomEvent, Track, VideoPresets, ScreenSharePresets, ConnectionState, DisconnectReason,
} from 'livekit-client'
import { api } from '../../services/api'
import { rafThrottle, isFinalDisconnect, disconnectMessage, mediaErrorMessage } from './liveUtils'

const REJOIN_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000]

function createRoom() {
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    disconnectOnPageLeave: true,
    videoCaptureDefaults: { resolution: VideoPresets.h540.resolution },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      videoEncoding: VideoPresets.h540.encoding,
      screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
      screenShareSimulcastLayers: [ScreenSharePresets.h360fps3],
      dtx: true,
      red: true,
    },
  })
}

export function useLiveRoom(classId) {
  const roomRef = useRef(null)
  const audioHostRef = useRef(null)
  const rejoinRef = useRef({ attempt: 0, timer: null, wanted: false })
  const mediaWanted = useRef({ mic: false, camera: false })
  const scheduleRejoinRef = useRef(() => {})
  const [phase, setPhase] = useState('prejoin')
  const [error, setError] = useState(null)
  const [endedReason, setEndedReason] = useState(null)
  const [info, setInfo] = useState(null)
  const [settings, setSettings] = useState({})
  const [messages, setMessages] = useState([])
  const [reactions, setReactions] = useState([])
  const [notices, setNotices] = useState([])
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [, setTick] = useState(0)
  const bump = useMemo(() => rafThrottle(() => setTick((t) => (t + 1) % 1e9)), [])

  const pushNotice = useCallback((text, tone = 'info') => {
    const id = `${Date.now()}-${Math.random()}`
    setNotices((n) => [...n.slice(-3), { id, text, tone }])
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 6000)
  }, [])

  const upsertMessage = useCallback((m) => {
    setMessages((list) => {
      const i = list.findIndex((x) => x.id === m.id)
      if (i === -1) return [...list, m].slice(-500)
      const next = list.slice()
      next[i] = { ...next[i], ...m }
      return next
    })
  }, [])

  const attachAudio = useCallback((track) => {
    if (!audioHostRef.current) {
      const host = document.createElement('div')
      host.style.display = 'none'
      host.setAttribute('data-live-audio', '')
      document.body.appendChild(host)
      audioHostRef.current = host
    }
    const el = track.attach()
    el.setAttribute('data-sid', track.sid || '')
    audioHostRef.current.appendChild(el)
  }, [])

  const wireRoom = useCallback((room) => {
    const parseSettings = (meta) => {
      try {
        if (meta) setSettings(JSON.parse(meta))
      } catch {
        return
      }
    }
    room
      .on(RoomEvent.ParticipantConnected, bump)
      .on(RoomEvent.ParticipantDisconnected, bump)
      .on(RoomEvent.TrackPublished, bump)
      .on(RoomEvent.TrackUnpublished, bump)
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) attachAudio(track)
        bump()
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove())
        bump()
      })
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.ActiveSpeakersChanged, bump)
      .on(RoomEvent.ConnectionQualityChanged, bump)
      .on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
        if (participant && 'hand' in changed && changed.hand && participant !== room.localParticipant) {
          pushNotice(`${participant.name || participant.identity} raised their hand ✋`)
        }
        if (participant && 'request' in changed && changed.request && participant !== room.localParticipant) {
          pushNotice(`${participant.name || participant.identity} asks to ${changed.request === 'screen' ? 'share their screen' : 'speak'}`)
        }
        bump()
      })
      .on(RoomEvent.ParticipantPermissionsChanged, bump)
      .on(RoomEvent.RoomMetadataChanged, (meta) => {
        parseSettings(meta)
        bump()
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
      .on(RoomEvent.MediaDevicesError, (err) => pushNotice(mediaErrorMessage(err, 'camera or microphone'), 'error'))
      .on(RoomEvent.Reconnecting, () => setPhase('reconnecting'))
      .on(RoomEvent.Reconnected, () => setPhase('connected'))
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (participant) return
        let data
        try {
          data = JSON.parse(new TextDecoder().decode(payload))
        } catch {
          return
        }
        if (topic === 'lc.message' || topic === 'lc.message.update') upsertMessage(data)
        else if (topic === 'lc.reaction') {
          const id = `${data.ts}-${Math.random()}`
          setReactions((r) => [...r.slice(-20), { ...data, id }])
          setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 4000)
        } else if (topic === 'lc.notice') {
          if (data.type === 'muted') pushNotice(`${data.by} muted your ${data.source === 'microphone' ? 'microphone' : data.source}.`, 'warning')
          if (data.type === 'permissions') pushNotice(`${data.by} updated what you can share.`)
        } else if (topic === 'lc.ended') {
          setEndedReason('The teacher ended this class.')
        }
      })
      .on(RoomEvent.Disconnected, (reason) => {
        bump()
        if (rejoinRef.current.leaving) return
        if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED) {
          setEndedReason((r) => r || 'The teacher ended this class.')
          setPhase('ended')
          return
        }
        if (isFinalDisconnect(reason)) {
          setEndedReason(disconnectMessage(reason))
          setPhase('ended')
          return
        }
        scheduleRejoinRef.current()
      })
    parseSettings(room.metadata)
  }, [attachAudio, bump, pushNotice, upsertMessage])

  const cleanupRoom = useCallback(async () => {
    const room = roomRef.current
    roomRef.current = null
    if (room) {
      room.removeAllListeners()
      try {
        await room.disconnect(true)
      } catch {
        return
      }
    }
    if (audioHostRef.current) {
      audioHostRef.current.remove()
      audioHostRef.current = null
    }
  }, [])

  const connect = useCallback(async ({ mic, camera, devices } = {}) => {
    setError(null)
    const join = await api.post(`/live-classes/${classId}/join`)
    setInfo(join)
    setSettings(join.live_class.settings || {})
    const room = createRoom()
    wireRoom(room)
    roomRef.current = room
    await room.connect(join.url, join.token, { autoSubscribe: true })
    if (devices?.audioinput) await room.switchActiveDevice('audioinput', devices.audioinput).catch(() => {})
    if (devices?.videoinput) await room.switchActiveDevice('videoinput', devices.videoinput).catch(() => {})
    setAudioBlocked(!room.canPlaybackAudio)
    const history = await api.get(`/live-classes/${classId}/messages`).catch(() => [])
    setMessages((list) => {
      const byId = new Map(history.map((m) => [m.id, m]))
      list.forEach((m) => byId.set(m.id, { ...byId.get(m.id), ...m }))
      return [...byId.values()].sort((a, b) => a.id - b.id)
    })
    const lp = room.localParticipant
    if (mic) await lp.setMicrophoneEnabled(true).catch((e) => pushNotice(mediaErrorMessage(e, 'microphone'), 'error'))
    if (camera) await lp.setCameraEnabled(true).catch((e) => pushNotice(mediaErrorMessage(e, 'camera'), 'error'))
    rejoinRef.current.attempt = 0
    setPhase('connected')
    bump()
    return room
  }, [bump, classId, pushNotice, wireRoom])

  const scheduleRejoin = useCallback(() => {
    const state = rejoinRef.current
    const lp = roomRef.current?.localParticipant
    mediaWanted.current = { mic: !!lp?.isMicrophoneEnabled, camera: !!lp?.isCameraEnabled }
    if (state.attempt >= REJOIN_DELAYS_MS.length) {
      setPhase('error')
      setError("We couldn't reconnect you to the class. Check your internet connection and try again.")
      return
    }
    setPhase('rejoining')
    const delay = REJOIN_DELAYS_MS[state.attempt]
    state.attempt += 1
    clearTimeout(state.timer)
    state.timer = setTimeout(async () => {
      await cleanupRoom()
      try {
        await connect(mediaWanted.current)
      } catch (err) {
        if (err?.status === 403 || err?.status === 410) {
          setEndedReason(err.message)
          setPhase('ended')
          return
        }
        scheduleRejoin()
      }
    }, delay)
  }, [cleanupRoom, connect])
  scheduleRejoinRef.current = scheduleRejoin

  const join = useCallback(async (opts) => {
    setPhase('joining')
    rejoinRef.current.leaving = false
    try {
      await connect(opts)
    } catch (err) {
      await cleanupRoom()
      setPhase('prejoin')
      setError(err?.message || 'Could not join the class.')
    }
  }, [cleanupRoom, connect])

  const leave = useCallback(async () => {
    rejoinRef.current.leaving = true
    clearTimeout(rejoinRef.current.timer)
    await cleanupRoom()
    setPhase('left')
  }, [cleanupRoom])

  useEffect(() => {
    const state = rejoinRef.current
    return () => {
      state.leaving = true
      clearTimeout(state.timer)
      cleanupRoom()
    }
  }, [cleanupRoom])

  useEffect(() => {
    if (endedReason && roomRef.current) {
      rejoinRef.current.leaving = true
      cleanupRoom().then(() => setPhase('ended'))
    }
  }, [endedReason, cleanupRoom])

  const room = roomRef.current
  const participants = room
    ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())]
    : []

  return {
    room,
    phase,
    error,
    setError,
    endedReason,
    info,
    settings,
    messages,
    reactions,
    notices,
    pushNotice,
    audioBlocked,
    participants,
    join,
    leave,
    refresh: bump,
    startAudio: async () => {
      await roomRef.current?.startAudio()
      setAudioBlocked(!roomRef.current?.canPlaybackAudio)
    },
    connectionState: room?.state || ConnectionState.Disconnected,
  }
}