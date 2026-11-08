import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X, AlertCircle, Eye, EyeOff, Lightbulb } from 'lucide-react'
import MathInput from '../math/MathInput'
import MathText from '../math/MathText'
import { MediaManager } from './QuestionMedia'
import { api } from '../../services/api'
import QuestionRenderer from './QuestionRenderer'
import { TYPE_MAP, placeholderCount, resizeMatrix, marksError, previewQuestion, MARKS_MIN, MARKS_MAX } from './questionTypes'
import UnifiedAnswerEditor from '../answer-editor/UnifiedAnswerEditor'
import { COMPONENTS, COMPONENT_LABELS, combineQuestionDoc, splitQuestionDoc } from '../answer-editor/schema'

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white'
const labelCls = 'text-[10px] font-semibold uppercase tracking-wide text-slate-400'

function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600" />
      {label}
    </label>
  )
}

function IconBtn({ onClick, disabled, title, children, danger }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-1 text-slate-400 disabled:opacity-30 ${danger ? 'hover:text-rose-600' : 'hover:text-brand-600'}`}
    >
      {children}
    </button>
  )
}

function OptionPreview({ text }) {
  if (!/\$[^$]+\$/.test(text || '')) return null
  return <MathText text={text} className="mt-0.5 text-xs text-slate-600 dark:text-slate-300" />
}

function ListEditor({ items, onChange, placeholder, min = 1, max = 20, ordered = false }) {
  const set = (i, v) => onChange(items.map((x, idx) => (idx === i ? v : x)))
  const move = (i, d) => {
    const next = [...items]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-1.5">
          {ordered && <span className="mt-1.5 w-5 text-right text-[11px] font-semibold text-slate-400">{i + 1}.</span>}
          <div className="flex-1">
            <input value={it} onChange={(e) => set(i, e.target.value)} placeholder={`${placeholder} ${i + 1}`} className={inputCls} />
            <OptionPreview text={it} />
          </div>
          {ordered && (
            <>
              <IconBtn title="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
              <IconBtn title="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
            </>
          )}
          <IconBtn danger title="Remove" onClick={() => onChange(items.filter((_, idx) => idx !== i))} disabled={items.length <= min}>
            <X className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      ))}
      {items.length < max && (
        <button type="button" onClick={() => onChange([...items, ''])} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
          <Plus className="h-3 w-3" /> Add
        </button>
      )}
    </div>
  )
}

function ChoiceEditor({ q, onChange, multi }) {
  const options = q.options || []
  const setOption = (i, v) => onChange({ options: options.map((o, idx) => (idx === i ? v : o)) })
  const addOption = () => onChange({ options: [...options, ''], correctFlags: [...(q.correctFlags || []), false] })
  const removeOption = (i) => {
    const next = { options: options.filter((_, idx) => idx !== i) }
    if (multi) next.correctFlags = (q.correctFlags || []).filter((_, idx) => idx !== i)
    else next.correctIndex = q.correctIndex === i ? 0 : q.correctIndex > i ? q.correctIndex - 1 : q.correctIndex
    onChange(next)
  }
  const isTf = q.type === 'tf'
  return (
    <div className="space-y-1.5">
      <p className={labelCls}>{multi ? 'Tick every correct answer' : 'Select the correct answer'}</p>
      {options.map((opt, oi) => (
        <div key={oi} className="flex items-start gap-2">
          <input
            type={multi ? 'checkbox' : 'radio'}
            checked={multi ? !!q.correctFlags?.[oi] : q.correctIndex === oi}
            onChange={() =>
              multi
                ? onChange({ correctFlags: options.map((_, i) => (i === oi ? !q.correctFlags?.[i] : !!q.correctFlags?.[i])) })
                : onChange({ correctIndex: oi })
            }
            className="mt-2 h-3.5 w-3.5 text-brand-600"
          />
          {isTf ? (
            <span className="mt-1 text-xs text-slate-600 dark:text-slate-300">{opt}</span>
          ) : (
            <div className="flex-1">
              <input value={opt} onChange={(e) => setOption(oi, e.target.value)} placeholder={`Option ${oi + 1} (use $...$ for math)`} className={inputCls} />
              <OptionPreview text={opt} />
            </div>
          )}
          {!isTf && (
            <IconBtn danger title="Remove option" onClick={() => removeOption(oi)} disabled={options.length <= 2}>
              <X className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </div>
      ))}
      {!isTf && options.length < 10 && (
        <button type="button" onClick={addOption} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
          <Plus className="h-3 w-3" /> Add option
        </button>
      )}
      {!isTf && (
        <div className="flex flex-wrap gap-4 pt-1">
          <Toggle checked={q.settings.shuffle_options} onChange={(v) => onChange({ settings: { ...q.settings, shuffle_options: v } })} label="Shuffle options per student" />
          {multi && (
            <Toggle checked={q.settings.partial_credit !== false} onChange={(v) => onChange({ settings: { ...q.settings, partial_credit: v } })} label="Partial credit" />
          )}
        </div>
      )}
    </div>
  )
}

function AnswerToolsPicker({ value, onChange }) {
  const current = Array.isArray(value) ? value : COMPONENTS
  const toggle = (c) => onChange(COMPONENTS.filter((x) => (x === c ? !current.includes(c) : current.includes(x))))
  return (
    <fieldset>
      <legend className={`${labelCls} mb-1`}>Answer tools students may use (text is always allowed)</legend>
      <div className="flex flex-wrap gap-3">
        {COMPONENTS.map((c) => (
          <Toggle key={c} checked={current.includes(c)} onChange={() => toggle(c)} label={COMPONENT_LABELS[c]} />
        ))}
      </div>
    </fieldset>
  )
}

function HotspotEditor({ q, onChange }) {
  const boxRef = useRef(null)
  const [draft, setDraft] = useState(null)
  const img = q.media?.[0]
  if (!img) return <p className="text-xs text-amber-600">Upload an image above, then draw the correct region(s) on it.</p>

  const point = (e) => {
    const r = boxRef.current.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }
  const onDown = (e) => {
    e.preventDefault()
    boxRef.current.setPointerCapture?.(e.pointerId)
    const p = point(e)
    setDraft({ sx: p.x, sy: p.y, x: p.x, y: p.y, w: 0, h: 0 })
  }
  const onMove = (e) => {
    if (!draft) return
    const p = point(e)
    setDraft((d) => ({ ...d, x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) }))
  }
  const onUp = () => {
    if (draft && draft.w > 0.01 && draft.h > 0.01 && (q.regions || []).length < 10) {
      const r = { x: +draft.x.toFixed(4), y: +draft.y.toFixed(4), w: +draft.w.toFixed(4), h: +draft.h.toFixed(4) }
      onChange({ regions: [...(q.regions || []), r] })
    }
    setDraft(null)
  }
  return (
    <div className="space-y-2">
      <p className={labelCls}>Drag on the image to draw correct region(s) — the first image is used</p>
      <div
        ref={boxRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="relative inline-block max-w-full cursor-crosshair select-none touch-none"
      >
        <img src={api.mediaUrl(img.url)} alt="Hotspot" draggable={false} className="block max-h-[420px] max-w-full" />
        {(q.regions || []).map((r, i) => (
          <div
            key={i}
            className="absolute border-2 border-emerald-500 bg-emerald-400/25"
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
          >
            <span className="absolute -left-0.5 -top-5 rounded bg-emerald-600 px-1 text-[10px] font-bold text-white">{i + 1}</span>
          </div>
        ))}
        {draft && (
          <div
            className="absolute border-2 border-dashed border-brand-500 bg-brand-400/20"
            style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}
          />
        )}
      </div>
      {(q.regions || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {q.regions.map((_, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
              Region {i + 1}
              <button type="button" onClick={() => onChange({ regions: q.regions.filter((__, idx) => idx !== i) })}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function TypeBody({ q, onChange }) {
  const s = q.settings || {}
  const setS = (patch) => onChange({ settings: { ...s, ...patch } })

  switch (q.type) {
    case 'mcq':
    case 'tf':
      return <ChoiceEditor q={q} onChange={onChange} />
    case 'multi':
      return <ChoiceEditor q={q} onChange={onChange} multi />
    case 'short':
      return (
        <div className="space-y-2">
          <AnswerToolsPicker value={s.allowed_components} onChange={(v) => setS({ allowed_components: v })} />
          <p className="text-xs text-slate-400">Students answer in the unified editor. Graded manually.</p>
        </div>
      )
    case 'essay':
      return (
        <div className="space-y-2">
          <AnswerToolsPicker value={s.allowed_components} onChange={(v) => setS({ allowed_components: v })} />
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">
              <span className={`${labelCls} mb-1 block`}>Word limit (optional)</span>
              <input type="number" min={1} value={s.word_limit ?? ''} onChange={(e) => setS({ word_limit: e.target.value })} className={`${inputCls} w-28`} />
            </label>
            <p className="text-xs text-slate-400">Long, mixed-format answer in the unified editor. Graded manually.</p>
          </div>
        </div>
      )
    case 'fill_blank':
      return (
        <div className="space-y-2">
          <p className={labelCls}>Accepted answers per blank — separate alternatives with |</p>
          {q.blankText.length === 0 && <p className="text-xs text-amber-600">Click the Blank button in the question toolbar where the blank should appear.</p>}
          {q.blankText.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[11px] font-semibold text-slate-500">Blank {i + 1}</span>
              <input
                value={t}
                onChange={(e) => onChange({ blankText: q.blankText.map((x, idx) => (idx === i ? e.target.value : x)) })}
                placeholder="e.g. Paris | paris"
                className={inputCls}
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-4">
            <Toggle checked={s.case_sensitive} onChange={(v) => setS({ case_sensitive: v })} label="Case sensitive" />
            <Toggle checked={s.partial_credit !== false} onChange={(v) => setS({ partial_credit: v })} label="Partial credit" />
          </div>
        </div>
      )
    case 'dropdown':
      return (
        <div className="space-y-3">
          {q.dropdowns.length === 0 && <p className="text-xs text-amber-600">Click the Dropdown button in the question toolbar where the dropdown should appear.</p>}
          {q.dropdowns.map((d, di) => {
            const setD = (patch) => onChange({ dropdowns: q.dropdowns.map((x, idx) => (idx === di ? { ...x, ...patch } : x)) })
            return (
              <div key={di} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <p className={`${labelCls} mb-1.5`}>Dropdown [[{di + 1}]] — select the correct option</p>
                <div className="space-y-1.5">
                  {d.options.map((o, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input type="radio" checked={d.correctIndex === oi} onChange={() => setD({ correctIndex: oi })} className="h-3.5 w-3.5 text-brand-600" />
                      <input
                        value={o}
                        onChange={(e) => setD({ options: d.options.map((x, idx) => (idx === oi ? e.target.value : x)) })}
                        placeholder={`Option ${oi + 1}`}
                        className={inputCls}
                      />
                      <IconBtn
                        danger
                        title="Remove"
                        disabled={d.options.length <= 2}
                        onClick={() => setD({ options: d.options.filter((_, idx) => idx !== oi), correctIndex: d.correctIndex >= oi && d.correctIndex > 0 ? d.correctIndex - 1 : d.correctIndex })}
                      >
                        <X className="h-3.5 w-3.5" />
                      </IconBtn>
                    </div>
                  ))}
                  {d.options.length < 10 && (
                    <button type="button" onClick={() => setD({ options: [...d.options, ''] })} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
                      <Plus className="h-3 w-3" /> Add option
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          <Toggle checked={s.partial_credit !== false} onChange={(v) => setS({ partial_credit: v })} label="Partial credit" />
        </div>
      )
    case 'numeric': {
      const n = q.numeric
      const setN = (patch) => onChange({ numeric: { ...n, ...patch } })
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-xs">
            <span className={`${labelCls} mb-1 block`}>Answer type</span>
            <select value={n.mode} onChange={(e) => setN({ mode: e.target.value })} className={inputCls}>
              <option value="exact">Exact ± tolerance</option>
              <option value="range">Within a range</option>
            </select>
          </label>
          {n.mode === 'exact' ? (
            <>
              <label className="text-xs">
                <span className={`${labelCls} mb-1 block`}>Correct value</span>
                <input type="number" step="any" value={n.value} onChange={(e) => setN({ value: e.target.value })} className={inputCls} />
              </label>
              <label className="text-xs">
                <span className={`${labelCls} mb-1 block`}>Tolerance (±)</span>
                <input type="number" step="any" min={0} value={n.tolerance} onChange={(e) => setN({ tolerance: e.target.value })} className={inputCls} />
              </label>
            </>
          ) : (
            <>
              <label className="text-xs">
                <span className={`${labelCls} mb-1 block`}>Minimum</span>
                <input type="number" step="any" value={n.min} onChange={(e) => setN({ min: e.target.value })} className={inputCls} />
              </label>
              <label className="text-xs">
                <span className={`${labelCls} mb-1 block`}>Maximum</span>
                <input type="number" step="any" value={n.max} onChange={(e) => setN({ max: e.target.value })} className={inputCls} />
              </label>
            </>
          )}
          <label className="text-xs">
            <span className={`${labelCls} mb-1 block`}>Unit (optional)</span>
            <input value={s.unit || ''} maxLength={40} onChange={(e) => setS({ unit: e.target.value })} placeholder="e.g. m/s" className={inputCls} />
          </label>
        </div>
      )
    }
    case 'math': {
      const m = q.math
      const setM = (patch) => onChange({ math: { ...m, ...patch } })
      return (
        <div className="space-y-2">
          <label className="block text-xs">
            <span className={`${labelCls} mb-1 block`}>Grading</span>
            <select value={m.mode} onChange={(e) => setM({ mode: e.target.value })} className={`${inputCls} sm:w-80`}>
              <option value="symbolic">Auto — mathematically equivalent (algebra/calculus)</option>
              <option value="exact">Auto — exact notation match (logic/sets/proofs)</option>
              <option value="manual">Manual grading by teacher</option>
            </select>
          </label>
          <p className="text-[11px] text-slate-400">
            Equivalent mode accepts e.g. 2(x+1) for 2x+2. Answers it cannot verify are sent to manual review instead of being marked wrong.
          </p>
          {m.answers.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <p className={`${labelCls} mb-1`}>{i === 0 ? 'Correct answer (LaTeX)' : `Alternative ${i}`}</p>
                <MathInput mode="latex" singleLine value={a} onChange={(v) => setM({ answers: m.answers.map((x, idx) => (idx === i ? v : x)) })} placeholder="\forall x \in \mathbb{R}, x^2 \geq 0" maxLength={2000} />
              </div>
              {m.answers.length > 1 && (
                <IconBtn danger title="Remove" onClick={() => setM({ answers: m.answers.filter((_, idx) => idx !== i) })}>
                  <X className="h-3.5 w-3.5" />
                </IconBtn>
              )}
            </div>
          ))}
          {m.answers.length < 10 && (
            <button type="button" onClick={() => setM({ answers: [...m.answers, ''] })} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
              <Plus className="h-3 w-3" /> Add alternative answer
            </button>
          )}
        </div>
      )
    }
    case 'matrix': {
      const rows = Number(s.rows) || 2
      const cols = Number(s.cols) || 2
      const setDims = (r, c) => onChange({ settings: { ...s, rows: r, cols: c }, matrix: { ...q.matrix, cells: resizeMatrix(q.matrix.cells, r, c) } })
      const setCell = (r, c, v) => onChange({ matrix: { ...q.matrix, cells: q.matrix.cells.map((row, ri) => row.map((x, ci) => (ri === r && ci === c ? v : x))) } })
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className={`${labelCls} mb-1 block`}>Rows</span>
              <select value={rows} onChange={(e) => setDims(Number(e.target.value), cols)} className={`${inputCls} w-20`}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className={`${labelCls} mb-1 block`}>Columns</span>
              <select value={cols} onChange={(e) => setDims(rows, Number(e.target.value))} className={`${inputCls} w-20`}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className={`${labelCls} mb-1 block`}>Grading</span>
              <select value={q.matrix.mode} onChange={(e) => onChange({ matrix: { ...q.matrix, mode: e.target.value } })} className={`${inputCls} w-56`}>
                <option value="symbolic">Auto — equivalent values (1/2 = 0.5)</option>
                <option value="exact">Auto — exact match</option>
                <option value="manual">Manual grading</option>
              </select>
            </label>
            <Toggle checked={s.partial_credit !== false} onChange={(v) => setS({ partial_credit: v })} label="Partial credit per cell" />
          </div>
          <p className={labelCls}>Answer matrix {q.matrix.mode === 'manual' ? '(optional reference)' : ''} — cells accept numbers, fractions or LaTeX like \sqrt{2}</p>
          <div className="overflow-x-auto">
            <div className="inline-flex items-stretch gap-1">
              <span className="w-1.5 rounded-l border-y-2 border-l-2 border-slate-400" />
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(3.5rem, 5rem))` }}>
                {q.matrix.cells.map((row, r) =>
                  row.map((v, c) => (
                    <input key={`${r}-${c}`} value={v} onChange={(e) => setCell(r, c, e.target.value)} className={`${inputCls} text-center font-mono`} />
                  )),
                )}
              </div>
              <span className="w-1.5 rounded-r border-y-2 border-r-2 border-slate-400" />
            </div>
          </div>
        </div>
      )
    }
    case 'matching':
      return (
        <div className="space-y-2">
          <p className={labelCls}>Pairs (prompt → correct answer)</p>
          {q.pairs.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={p.prompt} onChange={(e) => onChange({ pairs: q.pairs.map((x, idx) => (idx === i ? { ...x, prompt: e.target.value } : x)) })} placeholder={`Prompt ${i + 1}`} className={inputCls} />
              <span className="text-slate-400">→</span>
              <input value={p.answer} onChange={(e) => onChange({ pairs: q.pairs.map((x, idx) => (idx === i ? { ...x, answer: e.target.value } : x)) })} placeholder={`Answer ${i + 1}`} className={inputCls} />
              <IconBtn danger title="Remove" disabled={q.pairs.length <= 2} onClick={() => onChange({ pairs: q.pairs.filter((_, idx) => idx !== i) })}>
                <X className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          ))}
          {q.pairs.length < 20 && (
            <button type="button" onClick={() => onChange({ pairs: [...q.pairs, { prompt: '', answer: '' }] })} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
              <Plus className="h-3 w-3" /> Add pair
            </button>
          )}
          <p className={`${labelCls} pt-1`}>Extra wrong answers (distractors, optional)</p>
          <ListEditor items={q.distractors} onChange={(v) => onChange({ distractors: v })} placeholder="Distractor" min={0} max={10} />
          <Toggle checked={s.partial_credit !== false} onChange={(v) => setS({ partial_credit: v })} label="Partial credit" />
        </div>
      )
    case 'ordering':
      return (
        <div className="space-y-2">
          <p className={labelCls}>Enter items in the CORRECT order — students see them shuffled</p>
          <ListEditor items={q.items} onChange={(v) => onChange({ items: v })} placeholder="Item" min={2} max={20} ordered />
          <Toggle checked={s.partial_credit !== false} onChange={(v) => setS({ partial_credit: v })} label="Partial credit (per correct position)" />
        </div>
      )
    case 'hotspot':
      return <HotspotEditor q={q} onChange={onChange} />
    case 'file_upload':
      return (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className={`${labelCls} mb-1 block`}>Accepted files</span>
            <select value={s.accept || 'both'} onChange={(e) => setS({ accept: e.target.value })} className={`${inputCls} w-40`}>
              <option value="both">Images and PDF</option>
              <option value="image">Images only</option>
              <option value="pdf">PDF only</option>
            </select>
          </label>
          <label className="text-xs">
            <span className={`${labelCls} mb-1 block`}>Max files</span>
            <select value={s.max_files || 1} onChange={(e) => setS({ max_files: Number(e.target.value) })} className={`${inputCls} w-20`}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <p className="text-xs text-slate-400">For handwritten working. Graded manually.</p>
        </div>
      )
    case 'text_block':
      return <p className="text-xs text-slate-400">Shown to students as information only — not graded.</p>
    default:
      return null
  }
}

export function QuestionPreview({ q, className = '' }) {
  const noop = () => {}
  return (
    <div className={className} data-testid="question-preview">
      <QuestionRenderer question={previewQuestion(q)} value={undefined} onChange={noop} disabled />
    </div>
  )
}

/** One field for the whole question: text, equations, tables, diagrams and code. */
function QuestionBody({ q, onChange }) {
  // Held locally so typing never resets the cursor; the question keeps the split text/richContent form.
  const [doc, setDoc] = useState(() => combineQuestionDoc(q.text, q.richContent))
  const usesPlaceholders = q.type === 'fill_blank' || q.type === 'dropdown'
  const isInfo = q.type === 'text_block'

  const handle = (next) => {
    setDoc(next)
    const { text, richContent } = splitQuestionDoc(next)
    onChange({ text, richContent })
  }

  const blankButton = usesPlaceholders
    ? (editor) => (
        <button
          type="button"
          data-testid="insert-placeholder"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const n = placeholderCount(splitQuestionDoc(editor.getJSON()).text) + 1
            editor.chain().focus().insertContent(`[[${n}]]`).run()
          }}
          className="ae-insert-btn"
        >
          <Plus className="h-3.5 w-3.5" /> {q.type === 'dropdown' ? 'Dropdown' : 'Blank'}
        </button>
      )
    : null

  return (
    <div className="space-y-1.5" data-testid="question-body">
      <UnifiedAnswerEditor
        key={`qb-${q.localId}`}
        variant="simple"
        showFooter={false}
        value={doc}
        onChange={handle}
        toolbarExtra={blankButton}
        placeholder={isInfo ? 'Write the instructions or reading passage…' : 'Type your question here…'}
        ariaLabel="Question"
      />
      <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
        <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          Click where you want something to appear, then use <b>Add</b> above: Equation, Table, Diagram or Code.
          Quick tip: typing <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">$x^2$</code> turns into an equation.
          {usesPlaceholders && <> Use <b>{q.type === 'dropdown' ? 'Dropdown' : 'Blank'}</b> to mark where students answer.</>}
        </span>
      </p>
    </div>
  )
}

export default function QuestionEditor({ q, index, total, onChange, onRemove, onMove, error }) {
  const meta = TYPE_MAP[q.type]
  const [showPreview, setShowPreview] = useState(false)
  return (
    <div className={`rounded-lg border p-3 ${error ? 'border-rose-300 dark:border-rose-500/40' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">
          Q{index + 1} · {meta?.label || q.type}
        </span>
        <div className="flex items-center gap-1.5">
          {q.type !== 'text_block' && (
            <>
              <input
                type="number"
                min={MARKS_MIN}
                max={MARKS_MAX}
                step={1}
                value={q.marks}
                aria-label="Marks for this question"
                aria-invalid={!!marksError(q.marks)}
                onChange={(e) => onChange({ marks: e.target.value })}
                className={`w-16 rounded border bg-slate-50 px-1.5 py-0.5 text-xs dark:bg-slate-800 dark:text-white ${
                  marksError(q.marks) ? 'border-rose-400 ring-1 ring-rose-300' : 'border-slate-200 dark:border-slate-700'
                }`}
              />
              <span className="text-[10px] text-slate-400">marks</span>
            </>
          )}
          <IconBtn title="Move up" onClick={() => onMove(-1)} disabled={index === 0}><ArrowUp className="h-4 w-4" /></IconBtn>
          <IconBtn title="Move down" onClick={() => onMove(1)} disabled={index === total - 1}><ArrowDown className="h-4 w-4" /></IconBtn>
          <IconBtn danger title="Delete question" onClick={onRemove}><Trash2 className="h-4 w-4" /></IconBtn>
        </div>
      </div>

      <div className="mt-2">
        <p className={`${labelCls} mb-1`}>{q.type === 'text_block' ? 'Instructions' : 'Question'}</p>
        <QuestionBody q={q} onChange={onChange} />
      </div>

      {q.type !== 'text_block' && marksError(q.marks) && (
        <p className="mt-1 text-right text-[11px] font-medium text-rose-600" role="alert">{marksError(q.marks)}</p>
      )}

      <div className="mt-3">
        <MediaManager
          media={q.media}
          onChange={(media) => onChange(q.type === 'hotspot' && media[0]?.url !== q.media?.[0]?.url ? { media, regions: [] } : { media })}
          label={q.type === 'hotspot' ? 'Hotspot image (required)' : 'Reference images (optional)'}
        />
      </div>

      <div className="mt-3">
        <TypeBody q={q} onChange={onChange} />
      </div>

      <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
        <button
          type="button"
          data-testid="toggle-preview"
          onClick={() => setShowPreview((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10"
        >
          {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showPreview ? 'Hide preview' : 'Preview as student'}
        </button>
        {showPreview && (
          <div className="mt-2 rounded-xl border border-dashed border-brand-300 bg-white p-4 dark:border-brand-500/40 dark:bg-slate-900">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-brand-600">This is what students will see</p>
            <QuestionPreview q={q} />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-rose-600">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </div>
  )
}
