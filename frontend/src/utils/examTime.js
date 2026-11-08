// Time helpers for exam scheduling.
//
// Every instant is stored and compared as UTC. A teacher types a wall-clock
// date/time *together with an explicit time zone*, so the resulting instant is
// unambiguous and never depends on the zone the computer happens to be set to.

export const browserTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

export const listTimeZones = () => {
  let zones = []
  try { zones = Intl.supportedValuesOf?.('timeZone') || [] } catch { /* older browser */ }
  if (!zones.length) zones = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Kolkata', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles']
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

const partsIn = (ms, timeZone) => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const o = {}
  f.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value })
  return o
}

// Offset (ms) of `timeZone` from UTC at the instant `ms`.
const offsetAt = (ms, timeZone) => {
  const p = partsIn(ms, timeZone)
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

// "2026-11-20" + "09:30" in `timeZone` -> UTC epoch ms (or null if incomplete/invalid).
export function zonedToUtcMs(dateStr, timeStr, timeZone) {
  if (!dateStr || !timeStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  if ([y, m, d, hh, mm].some((n) => Number.isNaN(n))) return null
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  let ms = guess - offsetAt(guess, timeZone)
  ms = guess - offsetAt(ms, timeZone) // second pass handles DST boundaries
  return Number.isNaN(ms) ? null : ms
}

// UTC epoch ms -> { date: "YYYY-MM-DD", time: "HH:mm" } as seen in `timeZone`.
export function utcMsToZoned(ms, timeZone) {
  if (ms == null || Number.isNaN(ms)) return { date: '', time: '' }
  const p = partsIn(ms, timeZone)
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

export function formatInZone(ms, timeZone) {
  if (ms == null) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
  }).format(new Date(ms))
}

export const formatUtc = (ms) => (ms == null ? '—' : formatInZone(ms, 'UTC'))
