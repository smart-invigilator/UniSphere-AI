import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2, ZoomIn, X } from 'lucide-react'
import { api } from '../../services/api'

const ACCEPT_IMAGES = 'image/png,image/jpeg,image/gif,image/webp'
const MAX_IMAGE_MB = 5

export function QuestionMediaView({ media, className = '' }) {
  const [zoom, setZoom] = useState(null)
  const items = (media || []).filter((m) => api.mediaUrl(m.url))
  if (!items.length) return null
  return (
    <>
      <div className={`grid gap-3 ${items.length > 1 ? 'sm:grid-cols-2' : ''} ${className}`}>
        {items.map((m) => (
          <figure key={m.url} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <button type="button" onClick={() => setZoom(m)} className="group relative block w-full">
              <img
                src={api.mediaUrl(m.url)}
                alt={m.caption || m.name || 'Question figure'}
                loading="lazy"
                draggable={false}
                className="mx-auto max-h-[420px] w-auto max-w-full object-contain"
              />
              <span className="absolute right-2 top-2 rounded-md bg-slate-900/60 p-1 text-white opacity-0 transition group-hover:opacity-100">
                <ZoomIn className="h-4 w-4" />
              </span>
            </button>
            {m.caption && (
              <figcaption className="border-t border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {m.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {zoom && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4"
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
        >
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={() => setZoom(null)}>
            <X className="h-5 w-5" />
          </button>
          <img
            src={api.mediaUrl(zoom.url)}
            alt={zoom.caption || 'Question figure'}
            draggable={false}
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

export function MediaManager({ media, onChange, max = 6, label = 'Reference images' }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const items = media || []

  const onFiles = async (files) => {
    setError(null)
    const list = Array.from(files || []).slice(0, Math.max(0, max - items.length))
    if (!list.length) return
    setUploading(true)
    const added = []
    try {
      for (const file of list) {
        if (file.size > MAX_IMAGE_MB * 1024 * 1024) throw new Error(`${file.name} is larger than ${MAX_IMAGE_MB} MB.`)
        const res = await api.upload('/uploads/question-media', file)
        added.push({ url: res.url, name: res.name, caption: '' })
      }
    } catch (e) {
      setError(e.message || 'Upload failed')
    } finally {
      if (added.length) onChange([...items, ...added])
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const update = (i, patch) => onChange(items.map((m, idx) => (idx === i ? { ...m, ...patch } : m)))
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        {items.length < max && (
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {uploading ? 'Uploading…' : 'Add image'}
          </button>
        )}
        <input ref={inputRef} type="file" accept={ACCEPT_IMAGES} multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </div>
      {error && <p className="text-[11px] font-medium text-rose-600">{error}</p>}
      {items.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((m, i) => (
            <div key={m.url} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <img src={api.mediaUrl(m.url)} alt={m.name} className="mx-auto max-h-32 w-auto max-w-full rounded object-contain" />
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  value={m.caption || ''}
                  maxLength={500}
                  onChange={(e) => update(i, { caption: e.target.value })}
                  placeholder="Caption (optional)"
                  className="min-w-0 flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <button type="button" onClick={() => remove(i)} className="text-slate-400 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}