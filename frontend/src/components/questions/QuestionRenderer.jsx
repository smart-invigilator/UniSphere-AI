import { Fragment, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, FileText, Loader2, MapPin, Paperclip, Trash2, Check } from 'lucide-react'
import MathText from '../math/MathText'
import MathInput from '../math/MathInput'
import UnifiedAnswerEditor from '../answer-editor/UnifiedAnswerEditor'
import AnswerDocumentView from '../answer-editor/AnswerDocumentView'
import { QuestionMediaView } from './QuestionMedia'
import { api } from '../../services/api'

const fieldCls =
  'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white'

function ChoiceRow({ label, selected, onClick, multi, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
        selected
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400'
          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center border-2 ${multi ? 'rounded' : 'rounded-full'} ${
          selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300 dark:border-slate-600'
        }`}
      >
        {selected && (multi ? <Check className="h-3 w-3 text-white" /> : <span className="h-1.5 w-1.5 rounded-full bg-white" />)}
      </span>
      <MathText text={label} as="span" className="min-w-0 flex-1" />
    </button>
  )
}

function InlineText({ text, renderSlot }) {
  const parts = useMemo(() => String(text || '').split(/(\[\[\d+\]\])/g), [text])
  return (
    <div className="text-sm font-medium leading-loose text-slate-900 dark:text-white">
      {parts.map((part, i) => {
        const m = part.match(/^\[\[(\d+)\]\]$/)
        if (m) return <Fragment key={i}>{renderSlot(Number(m[1]) - 1)}</Fragment>
        return <MathText key={i} text={part} as="span" className="whitespace-pre-wrap" block={false} />
      })}
    </div>
  )
}

function OrderingInput({ items, value, onChange, disabled }) {
  const current = Array.isArray(value) && value.length === items.length ? value : items
  const touched = Array.isArray(value) && value.length > 0
  const move = (i, d) => {
    const next = [...current]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">Use the arrows to arrange the items in the correct order.</p>
      {current.map((item, i) => (
        <div key={item} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          <span className="w-6 text-xs font-bold text-brand-600">{i + 1}.</span>
          <MathText text={item} className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200" />
          <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" disabled={disabled || i === current.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30">
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
      ))}
      {!touched && (
        <button type="button" disabled={disabled} onClick={() => onChange([...current])} className="text-xs font-semibold text-brand-600 hover:underline">
          Keep this order as my answer
        </button>
      )}
    </div>
  )
}

function HotspotInput({ media, value, onChange, disabled }) {
  const boxRef = useRef(null)
  const img = media?.[0]
  if (!img) return <p className="text-xs text-rose-600">Image unavailable for this question.</p>
  const onClick = (e) => {
    if (disabled) return
    const r = boxRef.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    onChange({ x: +x.toFixed(4), y: +y.toFixed(4) })
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">Click on the image to mark your answer. Click again to move the marker.</p>
      <div ref={boxRef} onClick={onClick} className="relative inline-block max-w-full cursor-crosshair select-none">
        <img src={api.mediaUrl(img.url)} alt={img.caption || 'Hotspot'} draggable={false} className="block max-h-[480px] max-w-full rounded-lg" />
        {value?.x != null && (
          <MapPin
            className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-full fill-rose-500 text-white drop-shadow"
            style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }}
          />
        )}
      </div>
      {img.caption && <p className="text-xs text-slate-500">{img.caption}</p>}
    </div>
  )
}

function FileUploadInput({ question, value, onChange, attemptId, disabled }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const files = Array.isArray(value) ? value : []
  const max = question.settings?.max_files || 1
  const accept = question.settings?.accept || 'both'
  const acceptAttr = accept === 'image' ? 'image/png,image/jpeg,image/gif,image/webp' : accept === 'pdf' ? 'application/pdf' : 'image/png,image/jpeg,image/gif,image/webp,application/pdf'

  const upload = async (list) => {
    setError(null)
    const picked = Array.from(list || []).slice(0, max - files.length)
    if (!picked.length) return
    setUploading(true)
    const added = []
    try {
      for (const f of picked) {
        if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is larger than 10 MB.`)
        const res = await api.upload(`/uploads/attempts/${attemptId}/questions/${question.id}`, f)
        added.push(res)
      }
    } catch (e) {
      setError(e.message || 'Upload failed')
    } finally {
      if (added.length) onChange([...files, ...added])
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        Upload {accept === 'image' ? 'images' : accept === 'pdf' ? 'PDF files' : 'images or PDF files'} of your work (max {max} file{max > 1 ? 's' : ''}, 10 MB each).
      </p>
      {files.map((f, i) => (
        <div key={f.url} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
          {f.kind === 'image' ? (
            <img src={api.mediaUrl(f.url)} alt={f.name} className="h-10 w-10 rounded object-cover" />
          ) : (
            <FileText className="h-5 w-5 text-rose-500" />
          )}
          <a href={api.mediaUrl(f.url)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-brand-600 hover:underline">
            {f.name}
          </a>
          <span className="text-[11px] text-slate-400">{Math.ceil((f.size || 0) / 1024)} KB</span>
          <button type="button" disabled={disabled} onClick={() => onChange(files.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-rose-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      {files.length < max && (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-brand-400 hover:text-brand-700 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          {uploading ? 'Uploading…' : 'Attach file'}
        </button>
      )}
      <input ref={inputRef} type="file" accept={acceptAttr} multiple={max > 1} className="hidden" onChange={(e) => upload(e.target.files)} />
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  )
}

export default function QuestionRenderer({ question: q, value, onChange, attemptId, disabled = false, saveStatus = 'idle', saveError = null }) {
  const s = q.settings || {}
  const inline = q.type === 'fill_blank' || q.type === 'dropdown'

  const setIndex = (i, v, length) => {
    const arr = Array.from({ length }, (_, idx) => (Array.isArray(value) ? value[idx] ?? '' : ''))
    arr[i] = v
    onChange(arr)
  }

  let body = null
  switch (q.type) {
    case 'mcq':
    case 'tf':
      body = (q.options || []).map((opt) => (
        <ChoiceRow key={opt} label={opt} selected={value === opt} onClick={() => onChange(opt)} disabled={disabled} />
      ))
      break
    case 'multi': {
      const sel = new Set(Array.isArray(value) ? value : [])
      body = (
        <>
          <p className="text-xs text-slate-400">Select all that apply.</p>
          {(q.options || []).map((opt) => (
            <ChoiceRow
              key={opt}
              multi
              label={opt}
              selected={sel.has(opt)}
              disabled={disabled}
              onClick={() => {
                const next = new Set(sel)
                next.has(opt) ? next.delete(opt) : next.add(opt)
                onChange((q.options || []).filter((o) => next.has(o)))
              }}
            />
          ))}
        </>
      )
      break
    }
    case 'short':
    case 'essay':
      body = (
        <UnifiedAnswerEditor
          key={`ae-${q.id}`}
          value={value}
          onChange={onChange}
          allowedComponents={s.allowed_components}
          readOnly={disabled}
          wordLimit={q.type === 'essay' ? s.word_limit : null}
          placeholder={q.type === 'essay' ? 'Write your detailed answer…' : 'Write your answer…'}
          saveStatus={saveStatus}
          saveError={saveError}
          ariaLabel={`Answer to question ${q.order + 1}`}
        />
      )
      break
    case 'numeric':
      body = (
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={value || ''}
            disabled={disabled}
            maxLength={64}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter a number, e.g. 3.14 or 1/2"
            className={`${fieldCls} w-64 font-mono`}
          />
          {s.unit && <span className="text-sm text-slate-500">{s.unit}</span>}
        </div>
      )
      break
    case 'math':
      body = (
        <>
          <p className="text-xs text-slate-400">Write your answer using the math symbols toolbar. The preview shows how it will be read.</p>
          <MathInput mode="latex" rows={3} value={value || ''} onChange={onChange} placeholder="e.g. \frac{x^2-1}{x-1}" disabled={disabled} showPreview maxLength={2000} />
        </>
      )
      break
    case 'matrix': {
      const rows = s.rows || 2
      const cols = s.cols || 2
      const grid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => value?.[r]?.[c] ?? ''))
      const setCell = (r, c, v) => onChange(grid.map((row, ri) => row.map((x, ci) => (ri === r && ci === c ? v : x))))
      body = (
        <>
          <p className="text-xs text-slate-400">Fill every cell. Numbers, fractions (1/2) or LaTeX (\sqrt{2}) are accepted.</p>
          <div className="overflow-x-auto py-1">
            <div className="inline-flex items-stretch gap-1.5">
              <span className="w-2 rounded-l border-y-2 border-l-2 border-slate-500" />
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(3.5rem, 5.5rem))` }}>
                {grid.map((row, r) =>
                  row.map((v, c) => (
                    <input
                      key={`${r}-${c}`}
                      value={v}
                      disabled={disabled}
                      maxLength={200}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      aria-label={`Row ${r + 1} column ${c + 1}`}
                      className={`${fieldCls} px-1.5 text-center font-mono`}
                    />
                  )),
                )}
              </div>
              <span className="w-2 rounded-r border-y-2 border-r-2 border-slate-500" />
            </div>
          </div>
        </>
      )
      break
    }
    case 'matching': {
      const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      body = (
        <div className="space-y-2">
          {(s.prompts || []).map((p) => (
            <div key={p} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-2 dark:border-slate-700">
              <MathText text={p} className="text-sm text-slate-700 dark:text-slate-200" />
              <select
                value={map[p] || ''}
                disabled={disabled}
                onChange={(e) => onChange({ ...map, [p]: e.target.value })}
                className={fieldCls}
              >
                <option value="">Select a match…</option>
                {(s.choices || []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )
      break
    }
    case 'ordering':
      body = <OrderingInput items={s.items || []} value={value} onChange={onChange} disabled={disabled} />
      break
    case 'hotspot':
      body = <HotspotInput media={q.media} value={value} onChange={onChange} disabled={disabled} />
      break
    case 'file_upload':
      body = <FileUploadInput question={q} value={value} onChange={onChange} attemptId={attemptId} disabled={disabled} />
      break
    default:
      body = null
  }

  return (
    <div className="space-y-4">
      {inline ? (
        <InlineText
          text={q.text}
          renderSlot={(i) => {
            const count = q.type === 'dropdown' ? (s.dropdowns || []).length : s.blank_count || 0
            const v = Array.isArray(value) ? value[i] ?? '' : ''
            if (q.type === 'dropdown') {
              return (
                <select
                  value={v}
                  disabled={disabled}
                  onChange={(e) => setIndex(i, e.target.value, count)}
                  className="mx-1 inline-block rounded-md border border-brand-300 bg-brand-50/50 px-2 py-0.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-brand-500/40 dark:bg-slate-800 dark:text-white"
                >
                  <option value="">Select…</option>
                  {(s.dropdowns?.[i] || []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              )
            }
            return (
              <input
                value={v}
                disabled={disabled}
                maxLength={500}
                onChange={(e) => setIndex(i, e.target.value, count)}
                aria-label={`Blank ${i + 1}`}
                className="mx-1 inline-block w-40 rounded-md border-b-2 border-brand-400 bg-brand-50/50 px-2 py-0.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:bg-slate-800 dark:text-white"
              />
            )
          }}
        />
      ) : (
        <MathText text={q.text} className="text-sm font-medium leading-relaxed text-slate-900 dark:text-white" />
      )}
      <QuestionMediaView media={q.type === 'hotspot' ? (q.media || []).slice(1) : q.media} />
      {s.rich_content && (
        <div data-testid="question-content-view">
          <AnswerDocumentView response={s.rich_content} ariaLabel="Question content" testId="question-content-doc" />
        </div>
      )}
      {body && <div className="space-y-2">{body}</div>}
    </div>
  )
}