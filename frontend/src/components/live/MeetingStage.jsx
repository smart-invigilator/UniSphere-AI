import { useEffect, useMemo, useState } from 'react'
import { Track } from 'livekit-client'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import ParticipantTile from './ParticipantTile'
import { participantRole, ROLE_TEACHER } from './liveUtils'

const GRID_PAGE_SIZE = 12
const FILMSTRIP_MAX = 8

export function tileSignature(p, source) {
  const pub = p.getTrackPublication(source === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera)
  const mic = p.getTrackPublication(Track.Source.Microphone)
  return [
    pub?.trackSid || '-', pub?.isMuted ? 1 : 0, pub?.track ? 1 : 0, mic?.isMuted !== false ? 1 : 0,
    p.isSpeaking ? 1 : 0, p.attributes?.hand || '', p.connectionQuality, p.name,
  ].join('|')
}

function hasScreen(p) {
  const pub = p.getTrackPublication(Track.Source.ScreenShare)
  return !!pub && !pub.isMuted && (p.isLocal || !!pub.track)
}

function gridColumns(n) {
  if (n <= 1) return 'grid-cols-1'
  if (n <= 4) return 'grid-cols-1 sm:grid-cols-2'
  if (n <= 9) return 'grid-cols-2 md:grid-cols-3'
  return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
}

export default function MeetingStage({ room, participants, layout, pinned, setPinned, spotlight }) {
  const [page, setPage] = useState(0)
  const screens = participants.filter(hasScreen)
  const activeSpeaker = room?.activeSpeakers?.find((p) => !p.isLocal) || null
  const teacher = participants.find((p) => participantRole(p) === ROLE_TEACHER)

  const focus = useMemo(() => {
    const byId = (id) => participants.find((p) => p.identity === id)
    if (pinned) {
      const [id, kind] = pinned.split('#')
      const p = byId(id)
      if (p && (kind !== 'screen' || hasScreen(p))) return { p, source: kind === 'screen' ? 'screen' : 'camera' }
    }
    if (spotlight && byId(spotlight)) return { p: byId(spotlight), source: 'camera' }
    if (screens[0]) return { p: screens[0], source: 'screen' }
    if (activeSpeaker) return { p: activeSpeaker, source: 'camera' }
    if (teacher) return { p: teacher, source: 'camera' }
    return participants[0] ? { p: participants[0], source: 'camera' } : null
  }, [participants, pinned, spotlight, screens, activeSpeaker, teacher])

  const tiles = useMemo(() => {
    const list = []
    screens.forEach((p) => list.push({ p, source: 'screen' }))
    participants.forEach((p) => list.push({ p, source: 'camera' }))
    return list
  }, [participants, screens])

  const pages = Math.max(1, Math.ceil(tiles.length / GRID_PAGE_SIZE))
  useEffect(() => {
    if (page >= pages) setPage(pages - 1)
  }, [page, pages])

  const tileKey = (t) => `${t.p.identity}#${t.source}`
  const pinFor = (t) => () => setPinned(pinned === tileKey(t) ? null : tileKey(t))
  const render = (t, extra = {}) => (
    <ParticipantTile
      key={tileKey(t)}
      participant={t.p}
      source={t.source}
      sig={tileSignature(t.p, t.source)}
      pinned={pinned === tileKey(t)}
      spotlighted={spotlight === t.p.identity && t.source === 'camera'}
      onPin={pinFor(t)}
      {...extra}
    />
  )

  if (!focus) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Waiting for participants…</div>

  if (layout === 'grid') {
    const visible = tiles.slice(page * GRID_PAGE_SIZE, (page + 1) * GRID_PAGE_SIZE)
    return (
      <div className="flex h-full flex-col gap-2" data-testid="stage-grid">
        <div className={`grid min-h-0 flex-1 auto-rows-fr gap-2 ${gridColumns(visible.length)}`}>
          {visible.map((t) => (
            <div key={tileKey(t)} className="min-h-[120px]">{render(t)}</div>
          ))}
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 text-xs text-slate-600 dark:text-slate-300">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-full bg-slate-300/70 p-1.5 text-slate-700 disabled:opacity-30 dark:bg-white/10 dark:text-white" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            Page {page + 1} of {pages}
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded-full bg-slate-300/70 p-1.5 text-slate-700 disabled:opacity-30 dark:bg-white/10 dark:text-white" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    )
  }

  const others = tiles.filter((t) => !(t.p === focus.p && t.source === focus.source))
  const strip = others.slice(0, FILMSTRIP_MAX)
  return (
    <div className="flex h-full flex-col gap-2 lg:flex-row" data-testid="stage-speaker">
      <div className="min-h-0 flex-1">{render(focus, { fit: 'contain' })}</div>
      {strip.length > 0 && (
        <div className="flex gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
          {strip.map((t) => (
            <div key={tileKey(t)} className="aspect-video w-40 shrink-0 lg:w-full">{render(t, { compact: true })}</div>
          ))}
          {others.length > strip.length && (
            <div className="flex aspect-video w-40 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-sm font-semibold text-slate-300 lg:w-full">
              +{others.length - strip.length} more
            </div>
          )}
        </div>
      )}
    </div>
  )
}