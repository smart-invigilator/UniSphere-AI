import { useRef, useState } from 'react'
import { mediaUrl } from '../../utils/questionTypes'

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v * 100) / 100))

export default function HotspotPicker({ src, alt = '', point, onPick, regions }) {
  const ref = useRef(null)
  const [failed, setFailed] = useState(false)
  if (!src) return <p className="text-xs text-rose-600">This question has no picture.</p>
  if (failed) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">The picture could not be loaded.</p>

  const pick = (e) => {
    if (!onPick || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    if (!r.width || !r.height) return
    onPick({ x: clamp(((e.clientX - r.left) / r.width) * 100), y: clamp(((e.clientY - r.top) / r.height) * 100) })
  }
  return (
    <div>
      <div className="relative inline-block max-w-full select-none overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <img
          ref={ref} src={mediaUrl(src)} alt={alt || 'Click the correct spot on the picture'} draggable={false}
          onClick={pick} onError={() => setFailed(true)}
          className={`block max-h-[26rem] w-auto max-w-full ${onPick ? 'cursor-crosshair' : ''}`}
        />
        {(regions || []).map((r, i) => (
          <div key={i} className="pointer-events-none absolute border-2 border-emerald-500 bg-emerald-400/25"
            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} />
        ))}
        {point && point.x != null && (
          <span className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-rose-600 shadow ring-2 ring-rose-600/40"
            style={{ left: `${point.x}%`, top: `${point.y}%` }} />
        )}
      </div>
      {onPick && <p className="mt-1 text-[11px] text-slate-400">Click the picture to place your answer. Click again to move it.</p>}
    </div>
  )
}
