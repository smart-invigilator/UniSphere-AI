import { memo, useEffect, useRef } from 'react'
import { Track, ConnectionQuality } from 'livekit-client'
import { MicOff, Pin, Hand, Star, MonitorUp } from 'lucide-react'
import { participantRole, ROLE_TEACHER } from './liveUtils'

function QualityBars({ quality }) {
  const level = { [ConnectionQuality.Excellent]: 3, [ConnectionQuality.Good]: 2, [ConnectionQuality.Poor]: 1, [ConnectionQuality.Lost]: 0 }[quality] ?? 3
  const color = level >= 3 ? 'bg-emerald-400' : level === 2 ? 'bg-amber-400' : 'bg-rose-500'
  return (
    <span className="flex items-end gap-px" title={`Connection: ${quality || 'unknown'}`} aria-label={`Connection quality ${quality || 'unknown'}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-1 rounded-sm ${i <= level ? color : 'bg-white/30'}`} style={{ height: 3 + i * 3 }} />
      ))}
    </span>
  )
}

function initials(name) {
  return (name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}

function ParticipantTile({ participant, source = 'camera', pinned = false, spotlighted = false, onPin, compact = false, fit = 'cover' }) {
  const videoRef = useRef(null)
  const isScreen = source === 'screen'
  const pub = participant.getTrackPublication(isScreen ? Track.Source.ScreenShare : Track.Source.Camera)
  const track = pub && !pub.isMuted ? pub.track : null
  const trackSid = track?.sid || null
  const micPub = participant.getTrackPublication(Track.Source.Microphone)
  const micMuted = !micPub || micPub.isMuted
  const hand = participant.attributes?.hand
  const role = participantRole(participant)
  const speaking = participant.isSpeaking && !isScreen

  useEffect(() => {
    const el = videoRef.current
    if (!track || !el) return undefined
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track, trackSid])

  const label = `${participant.name || participant.identity}${participant.isLocal ? ' (You)' : ''}`

  return (
    <div
      className={`group relative h-full w-full overflow-hidden rounded-xl bg-slate-800 ${speaking ? 'ring-2 ring-emerald-400' : 'ring-1 ring-white/5'}`}
      data-testid={isScreen ? 'screen-tile' : 'participant-tile'}
      data-identity={participant.identity}
      data-has-video={track ? 'true' : 'false'}
    >
      {track ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full ${fit === 'contain' || isScreen ? 'object-contain bg-black' : 'object-cover'}`}
          style={participant.isLocal && !isScreen ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className={`flex items-center justify-center rounded-full bg-brand-600 font-bold text-white ${compact ? 'h-10 w-10 text-sm' : 'h-16 w-16 text-xl'}`}>
            {initials(participant.name)}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-white">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          {isScreen && <MonitorUp className="h-3.5 w-3.5 shrink-0" />}
          {!isScreen && micMuted && <MicOff className="h-3.5 w-3.5 shrink-0 text-rose-300" aria-label="Microphone off" />}
          <span className="truncate">{isScreen ? `${label} — screen` : label}</span>
          {role === ROLE_TEACHER && <span className="rounded bg-brand-500/80 px-1 text-[9px] font-bold uppercase">Teacher</span>}
        </span>
        {!isScreen && <QualityBars quality={participant.connectionQuality} />}
      </div>
      <div className="absolute left-2 top-2 flex gap-1">
        {hand && !isScreen && (
          <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950" data-testid="hand-badge">
            <Hand className="h-3 w-3" /> Hand raised
          </span>
        )}
        {spotlighted && (
          <span className="flex items-center gap-1 rounded-full bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white">
            <Star className="h-3 w-3" /> Spotlight
          </span>
        )}
      </div>
      {onPin && (
        <button
          type="button"
          onClick={onPin}
          aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
          className={`absolute right-2 top-2 rounded-full p-1.5 text-white transition ${pinned ? 'bg-brand-600' : 'bg-black/40 opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
        >
          <Pin className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

export default memo(ParticipantTile)