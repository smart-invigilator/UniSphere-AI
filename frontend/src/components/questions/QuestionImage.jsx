import { useState } from 'react'
import { ZoomIn, X } from 'lucide-react'
import { mediaUrl } from '../../utils/questionTypes'
export default function QuestionImage({ src, alt = '', className = '' }) {
  const [zoom, setZoom] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!src) return null
  const url = mediaUrl(src)
  if (failed) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">The picture for this question could not be loaded.</p>
  return (
    <>
      <button
        type="button" onClick={() => setZoom(true)}
        className={`group relative block overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 ${className}`}
        aria-label="Enlarge picture"
      >
        <img
          src={url} alt={alt || 'Question picture'} loading="lazy" draggable={false}
          onError={() => setFailed(true)} className="mx-auto max-h-80 w-auto max-w-full object-contain"
        />
        <span className="absolute right-2 top-2 rounded bg-black/55 p-1 text-white opacity-0 transition group-hover:opacity-100"><ZoomIn className="h-4 w-4" /></span>
      </button>
      {zoom && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={() => setZoom(false)}>
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Close"><X className="h-5 w-5" /></button>
          <img src={url} alt={alt || 'Question picture'} className="max-h-full max-w-full rounded-lg bg-white object-contain" draggable={false} />
        </div>
      )}
    </>
  )
}
