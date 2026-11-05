import { DisconnectReason, Track } from 'livekit-client'

export const ROLE_TEACHER = 'teacher'
export const REACTIONS = ['👍', '👏', '❤️', '😂', '😮', '🎉', '🤔', '✋']

export function rafThrottle(fn) {
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      fn()
    })
  }
}

export function participantRole(p) {
  return p?.attributes?.role || (() => {
    try {
      return JSON.parse(p?.metadata || '{}').role || 'student'
    } catch {
      return 'student'
    }
  })()
}

export function userIdOf(p) {
  const id = p?.identity || ''
  return id.startsWith('u') ? Number(id.slice(1)) : null
}

export function canPublish(participant, source) {
  const sources = participant?.permissions?.canPublishSources
  if (!participant?.permissions) return false
  if (!participant.permissions.canPublish) return false
  if (!sources || sources.length === 0) return true
  const wanted = {
    [Track.Source.Microphone]: 2,
    [Track.Source.Camera]: 1,
    [Track.Source.ScreenShare]: 3,
  }[source]
  return sources.includes(wanted) || sources.includes(source)
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export function mediaErrorMessage(err, what) {
  const name = err?.name || ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return `Permission to use your ${what} was denied. Allow it in your browser's site settings and try again.`
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return `No ${what} was found on this device.`
  if (name === 'NotReadableError' || name === 'TrackStartError') return `Your ${what} is being used by another application.`
  if (name === 'NotSupportedError') return `Your browser doesn't support sharing your ${what}.`
  return `Couldn't start your ${what}. ${err?.message || ''}`.trim()
}

const FINAL_REASONS = new Set([
  DisconnectReason.CLIENT_INITIATED,
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.DUPLICATE_IDENTITY,
  DisconnectReason.ROOM_CLOSED,
])

export function isFinalDisconnect(reason) {
  return FINAL_REASONS.has(reason)
}

export function disconnectMessage(reason) {
  switch (reason) {
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return 'The teacher ended this class.'
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'The teacher removed you from this class.'
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'You joined this class from another tab or device, so this window was disconnected.'
    default:
      return 'You left the class.'
  }
}