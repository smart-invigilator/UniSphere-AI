export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

export function clockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const severityRank = { high: 3, medium: 2, low: 1 }

export function attentionBand(score) {
  if (score >= 80) return { label: 'High', color: 'emerald' }
  if (score >= 60) return { label: 'Moderate', color: 'amber' }
  return { label: 'Low', color: 'rose' }
}
