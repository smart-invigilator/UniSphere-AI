import { useRef, useState } from 'react'
import { Trash2, ImagePlus, X, ChevronUp, ChevronDown, Loader2 } from 'lucide-react'
import { api } from '../../services/api'
import MathField from '../math/MathField'
import { mediaUrl, typeLabel, blankCount, isManualType, marksIssue } from '../../utils/questionTypes'

const field = 'w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white'
const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400'
export default function QuestionEditor({ q, index, issue, onChange, onRemove }) {
  const [collapsed, setCollapsed] = useState(false)
  const set = (patch) => onChange(patch)
  return (
    <div className={`rounded-lg border p-3 ${issue ? 'border-amber-300 dark:border-amber-500/50' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">
            Q{index + 1} · {typeLabel(q.type)}{isManualType(q.type) ? ' · graded by you' : ''}
          </span>
          {collapsed && (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {q.text || 'No question text yet'}
              {issue && <span className="ml-2 font-medium text-amber-700 dark:text-amber-400">· Needs attention</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text" inputMode="numeric" maxLength={4}
            value={q.marks} aria-label="Marks" aria-invalid={!!marksIssue(q.marks)}
            onChange={(e) => {
              if (/^\d*$/.test(e.target.value)) set({ marks: e.target.value })
            }}
            className="w-14 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <span className="text-[10px] text-slate-400">marks</span>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="text-slate-400 hover:text-brand-600"
            aria-label={collapsed ? `Expand question ${index + 1}` : `Collapse question ${index + 1}`}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onRemove} className="text-slate-400 hover:text-rose-600" aria-label="Remove question"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {!collapsed && <>
      <div className="mt-2">
        <MathField
          multiline rows={q.type === 'fill_blank' ? 3 : 2} value={q.text}
          onChange={(text) => set(q.type === 'fill_blank' ? { text, blanks: resizeBlanks(q.blanks, blankCount(text)) } : { text })}
          placeholder={q.type === 'fill_blank'
            ? 'Write the sentence and mark blanks as [[1]], [[2]] …   e.g.  The [[1]] of a tree has n−1 edges.'
            : 'Question text…  Use “Math symbols” for ∀ ∃ ∧ ∨ matrices, or write LaTeX between $…$'}
          ariaLabel="Question text"
        />
        {q.type === 'fill_blank' && <p className="mt-1 text-[10px] text-slate-400">Put blanks outside $…$ formulas.</p>}
      </div>

      <ImageUploader q={q} onChange={set} required={q.type === 'hotspot'} />

      <div className="mt-3">
        {(q.type === 'mcq' || q.type === 'tf') && <ChoiceEditor q={q} onChange={set} />}
        {q.type === 'msq' && <MultiEditor q={q} onChange={set} />}
        {q.type === 'fill_blank' && <FillBlankEditor q={q} onChange={set} />}
        {q.type === 'numeric' && <NumericEditor q={q} onChange={set} />}
        {q.type === 'math_expr' && <ExprEditor q={q} onChange={set} />}
        {q.type === 'matrix' && <MatrixEditor q={q} onChange={set} />}
        {q.type === 'matching' && <MatchingEditor q={q} onChange={set} />}
        {q.type === 'ordering' && <OrderingEditor q={q} onChange={set} />}
        {q.type === 'hotspot' && <HotspotEditor q={q} onChange={set} />}
        {q.type === 'essay' && (
          <div className="max-w-[10rem]">
            <span className={label}>Word limit (optional)</span>
            <input type="number" min={1} value={q.maxWords} onChange={(e) => set({ maxWords: e.target.value })} className={field} />
          </div>
        )}
        {q.type === 'short' && <p className="text-[11px] text-slate-400">Students type an answer; you mark it after the exam (math symbols and pictures are supported).</p>}
      </div>
      {issue && <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">⚠ {issue}</p>}
      </>}
    </div>
  )
}

const resizeBlanks = (blanks, n) =>
  Array.from({ length: n }, (_, i) => blanks[i] || { answers: '', caseSensitive: false })

function Scoring({ q, onChange }) {
  return (
    <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-slate-500">
      Scoring
      <select value={q.scoring} onChange={(e) => onChange({ scoring: e.target.value })} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-white">
        <option value="partial">Partial credit</option>
        <option value="all_or_nothing">All or nothing</option>
      </select>
    </label>
  )
}

function ImageUploader({ q, onChange, required }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const upload = async (file) => {
    if (!file) return
    setError('')
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { setError('Choose a PNG, JPG or WEBP image.'); return }
    if (file.size > 5 * 1024 * 1024) { setError('Image is larger than 5 MB.'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.upload('/media/question-image', fd)
      onChange({ imageUrl: res.url, regions: q.type === 'hotspot' ? [] : q.regions })
    } catch (e) {
      setError(e.message || 'Upload failed')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="mt-2">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      {q.imageUrl ? (
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <img src={mediaUrl(q.imageUrl)} alt="" className="h-20 w-auto max-w-[9rem] rounded object-contain" />
          <div className="flex-1">
            <span className={label}>Describe the picture (for screen readers)</span>
            <input value={q.imageAlt} onChange={(e) => onChange({ imageAlt: e.target.value })} placeholder="e.g. Screenshot of a checkout form with no error message" className={field} />
            <div className="mt-1.5 flex gap-3 text-[11px] font-semibold">
              <button type="button" onClick={() => input.current?.click()} className="text-brand-600 hover:underline">Replace</button>
              {!required && <button type="button" onClick={() => onChange({ imageUrl: null, imageAlt: '' })} className="text-rose-600 hover:underline">Remove picture</button>}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button" disabled={busy} onClick={() => input.current?.click()}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs font-semibold ${required ? 'border-amber-400 text-amber-700' : 'border-slate-300 text-slate-500'} hover:border-brand-400 hover:text-brand-600`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
          {busy ? 'Uploading…' : required ? 'Upload the picture (required)' : 'Add a picture to this question'}
        </button>
      )}
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </div>
  )
}

function ChoiceEditor({ q, onChange }) {
  return (
    <div className="space-y-1.5">
      <span className={label}>Select the correct answer</span>
      {q.options.map((opt, oi) => (
        <label key={oi} className="flex items-center gap-2">
          <input type="radio" checked={q.correctIndex === oi} onChange={() => onChange({ correctIndex: oi })} className="h-3.5 w-3.5 text-brand-600" />
          {q.type === 'mcq'
            ? <input value={opt} onChange={(e) => onChange({ options: q.options.map((o, i) => (i === oi ? e.target.value : o)) })} placeholder={`Option ${oi + 1}  (math: $x^2$)`} className={field} />
            : <span className="text-xs text-slate-600 dark:text-slate-300">{opt}</span>}
        </label>
      ))}
      {q.type === 'mcq' && <OptionCount q={q} onChange={onChange} />}
    </div>
  )
}

function OptionCount({ q, onChange }) {
  const add = () => q.options.length < 10 && onChange({ options: [...q.options, ''], correctSet: [...q.correctSet, false] })
  const drop = () => {
    if (q.options.length <= 2) return
    const n = q.options.length - 1
    onChange({ options: q.options.slice(0, n), correctSet: q.correctSet.slice(0, n), correctIndex: Math.min(q.correctIndex, n - 1) })
  }
  return (
    <div className="flex gap-3 pt-1 text-[11px] font-semibold">
      <button type="button" onClick={add} className="text-brand-600 hover:underline">+ Add option</button>
      {q.options.length > 2 && <button type="button" onClick={drop} className="text-slate-500 hover:underline">− Remove last</button>}
    </div>
  )
}

function MultiEditor({ q, onChange }) {
  return (
    <div className="space-y-1.5">
      <span className={label}>Tick every correct answer</span>
      {q.options.map((opt, oi) => (
        <label key={oi} className="flex items-center gap-2">
          <input type="checkbox" checked={!!q.correctSet[oi]} onChange={() => onChange({ correctSet: q.options.map((_, i) => (i === oi ? !q.correctSet[i] : !!q.correctSet[i])) })} className="h-3.5 w-3.5 rounded text-brand-600" />
          <input value={opt} onChange={(e) => onChange({ options: q.options.map((o, i) => (i === oi ? e.target.value : o)) })} placeholder={`Option ${oi + 1}`} className={field} />
        </label>
      ))}
      <OptionCount q={q} onChange={onChange} />
      <Scoring q={q} onChange={onChange} />
    </div>
  )
}

function FillBlankEditor({ q, onChange }) {
  const n = blankCount(q.text)
  const blanks = resizeBlanks(q.blanks, n)
  const upd = (i, patch) => onChange({ blanks: blanks.map((b, bi) => (bi === i ? { ...b, ...patch } : b)) })
  if (!n) return <p className="text-[11px] text-slate-400">Add [[1]] in the text above to create the first blank.</p>
  return (
    <div className="space-y-2">
      <span className={label}>Accepted answers (separate alternatives with | )</span>
      {blanks.map((b, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="w-12 text-xs font-semibold text-slate-500">[[{i + 1}]]</span>
          <input value={b.answers} onChange={(e) => upd(i, { answers: e.target.value })} placeholder="e.g. root | root node" className={`${field} flex-1`} />
          <label className="flex items-center gap-1 text-[11px] text-slate-500">
            <input type="checkbox" checked={b.caseSensitive} onChange={(e) => upd(i, { caseSensitive: e.target.checked })} className="h-3 w-3 rounded" /> Case sensitive
          </label>
        </div>
      ))}
      <Scoring q={q} onChange={onChange} />
    </div>
  )
}

function NumericEditor({ q, onChange }) {
  const n = q.numeric
  const upd = (patch) => onChange({ numeric: { ...n, ...patch } })
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div><span className={label}>Correct value</span><input value={n.value} onChange={(e) => upd({ value: e.target.value })} placeholder="9.81 or 1/3 or sqrt(2)" className={field} /></div>
      <div><span className={label}>Accepted error (±)</span><input value={n.tolerance} onChange={(e) => upd({ tolerance: e.target.value })} className={field} /></div>
      <div>
        <span className={label}>Error type</span>
        <select value={n.toleranceType} onChange={(e) => upd({ toleranceType: e.target.value })} className={field}>
          <option value="absolute">Absolute</option><option value="percent">Percent</option>
        </select>
      </div>
      <div><span className={label}>Unit (shown to student)</span><input value={n.unit} onChange={(e) => upd({ unit: e.target.value })} placeholder="m/s²" className={field} /></div>
    </div>
  )
}

function ExprEditor({ q, onChange }) {
  return (
    <div>
      <span className={label}>Correct expression</span>
      <input value={q.expression} onChange={(e) => onChange({ expression: e.target.value })} placeholder="e.g. 3x^2 + 2x - 1" className={field} />
      <p className="mt-1 text-[10px] text-slate-400">
        Equivalent answers are accepted automatically: if the answer is x^2 − 1, then (x−1)(x+1) is also marked correct.
        Supported: + − * / ^ ( ), sqrt, abs, exp, ln, log, sin, cos, tan, pi, e and variables such as x, y.
      </p>
    </div>
  )
}

function MatrixEditor({ q, onChange }) {
  const m = q.matrix
  const resize = (rows, cols) => {
    rows = Math.max(1, Math.min(10, Number(rows) || 1)); cols = Math.max(1, Math.min(10, Number(cols) || 1))
    onChange({
      matrix: {
        rows, cols,
        cells: Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => m.cells[i]?.[j] ?? '')),
        rowLabels: Array.from({ length: rows }, (_, i) => m.rowLabels[i] ?? ''),
        colLabels: Array.from({ length: cols }, (_, j) => m.colLabels[j] ?? ''),
      },
    })
  }
  const setCell = (i, j, v) => onChange({ matrix: { ...m, cells: m.cells.map((r, ri) => r.map((c, ci) => (ri === i && ci === j ? v : c))) } })
  const labelsOn = m.colLabels.some((x) => x.trim()) || m.rowLabels.some((x) => x.trim())
  const setLabel = (kind, idx, v) => onChange({ matrix: { ...m, [kind]: m[kind].map((l, i) => (i === idx ? v : l)) } })
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <label>Rows <input type="number" min={1} max={10} value={m.rows} onChange={(e) => resize(e.target.value, m.cols)} className="ml-1 w-14 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
        <label>Columns <input type="number" min={1} max={10} value={m.cols} onChange={(e) => resize(m.rows, e.target.value)} className="ml-1 w-14 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
        <span className="text-[10px] text-slate-400">Fill in the CORRECT values. Numbers can be fractions (1/2); use T / F for truth tables.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              {labelsOn && <th />}
              {labelsOn && m.colLabels.map((c, j) => (
                <th key={j}><input value={c} onChange={(e) => setLabel('colLabels', j, e.target.value)} placeholder={`col ${j + 1}`} className="w-16 rounded border border-dashed border-slate-300 bg-transparent px-1 text-center text-[11px] dark:border-slate-600 dark:text-white" /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.cells.map((row, i) => (
              <tr key={i}>
                {labelsOn && <th><input value={m.rowLabels[i] ?? ''} onChange={(e) => setLabel('rowLabels', i, e.target.value)} placeholder={`row ${i + 1}`} className="w-16 rounded border border-dashed border-slate-300 bg-transparent px-1 text-center text-[11px] dark:border-slate-600 dark:text-white" /></th>}
                {row.map((cell, j) => (
                  <td key={j}><input value={cell} onChange={(e) => setCell(i, j, e.target.value)} aria-label={`Row ${i + 1} column ${j + 1}`} className="h-8 w-16 rounded-md border border-slate-300 bg-slate-50 px-1 text-center text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-white" /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!labelsOn && (
        <button type="button" onClick={() => onChange({ matrix: { ...m, colLabels: m.colLabels.map((_, j) => `c${j + 1}`), rowLabels: m.rowLabels.map((_, i) => `r${i + 1}`) } })} className="mt-1 text-[11px] font-semibold text-brand-600 hover:underline">
          + Add row / column labels (e.g. p, q, p∧q for a truth table)
        </button>
      )}
      <Scoring q={q} onChange={onChange} />
    </div>
  )
}

const nextId = (items, prefix) => `${prefix}${Math.max(0, ...items.map((i) => Number(String(i.id).slice(prefix.length)) || 0)) + 1}`

function MatchingEditor({ q, onChange }) {
  const setLeft = (id, text) => onChange({ left: q.left.map((l) => (l.id === id ? { ...l, text } : l)) })
  const setRight = (id, text) => onChange({ right: q.right.map((r) => (r.id === id ? { ...r, text } : r)) })
  const addLeft = () => { if (q.left.length < 10) onChange({ left: [...q.left, { id: nextId(q.left, 'l'), text: '' }] }) }
  const addRight = () => { if (q.right.length < 15) onChange({ right: [...q.right, { id: nextId(q.right, 'r'), text: '' }] }) }
  const dropLeft = (id) => {
    if (q.left.length <= 2) return
    const pairs = { ...q.pairs }; delete pairs[id]
    onChange({ left: q.left.filter((l) => l.id !== id), pairs })
  }
  const dropRight = (id) => {
    if (q.right.length <= 2) return
    const pairs = Object.fromEntries(Object.entries(q.pairs).filter(([, v]) => v !== id))
    onChange({ right: q.right.filter((r) => r.id !== id), pairs })
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <span className={label}>Left column + its correct match</span>
        {q.left.map((l) => (
          <div key={l.id} className="flex items-center gap-1.5">
            <input value={l.text} onChange={(e) => setLeft(l.id, e.target.value)} placeholder="Left item" className={field} />
            <select value={q.pairs[l.id] || ''} onChange={(e) => onChange({ pairs: { ...q.pairs, [l.id]: e.target.value } })} className={`${field} max-w-[9rem]`} aria-label="Correct match">
              <option value="">match…</option>
              {q.right.map((r, ri) => <option key={r.id} value={r.id}>{r.text || `Right ${ri + 1}`}</option>)}
            </select>
            <button type="button" onClick={() => dropLeft(l.id)} className="text-slate-400 hover:text-rose-600" aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <button type="button" onClick={addLeft} className="text-[11px] font-semibold text-brand-600 hover:underline">+ Add left item</button>
      </div>
      <div className="space-y-1.5">
        <span className={label}>Right column (extra items act as distractors)</span>
        {q.right.map((r) => (
          <div key={r.id} className="flex items-center gap-1.5">
            <input value={r.text} onChange={(e) => setRight(r.id, e.target.value)} placeholder="Right item" className={field} />
            <button type="button" onClick={() => dropRight(r.id)} className="text-slate-400 hover:text-rose-600" aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <button type="button" onClick={addRight} className="text-[11px] font-semibold text-brand-600 hover:underline">+ Add right item</button>
      </div>
      <div className="md:col-span-2"><Scoring q={q} onChange={onChange} /></div>
    </div>
  )
}

function OrderingEditor({ q, onChange }) {
  const move = (idx, dir) => {
    const next = [...q.items]; const j = idx + dir
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange({ items: next })
  }
  return (
    <div className="space-y-1.5">
      <span className={label}>List the items in the CORRECT order (students will see them shuffled)</span>
      {q.items.map((it, idx) => (
        <div key={it.id} className="flex items-center gap-1.5">
          <span className="w-5 text-center text-xs font-bold text-slate-400">{idx + 1}</span>
          <input value={it.text} onChange={(e) => onChange({ items: q.items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)) })} placeholder={`Step ${idx + 1}`} className={field} />
          <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="text-slate-400 hover:text-brand-600 disabled:opacity-30" aria-label="Move up"><ChevronUp className="h-4 w-4" /></button>
          <button type="button" onClick={() => move(idx, 1)} disabled={idx === q.items.length - 1} className="text-slate-400 hover:text-brand-600 disabled:opacity-30" aria-label="Move down"><ChevronDown className="h-4 w-4" /></button>
          <button type="button" onClick={() => q.items.length > 2 && onChange({ items: q.items.filter((x) => x.id !== it.id) })} className="text-slate-400 hover:text-rose-600" aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => q.items.length < 10 && onChange({ items: [...q.items, { id: nextId(q.items, 'i'), text: '' }] })} className="text-[11px] font-semibold text-brand-600 hover:underline">+ Add item</button>
        <Scoring q={q} onChange={onChange} />
      </div>
    </div>
  )
}

function HotspotEditor({ q, onChange }) {
  const ref = useRef(null)
  const [draft, setDraft] = useState(null)
  if (!q.imageUrl) return <p className="text-[11px] text-slate-400">Upload the picture above, then drag on it to mark the correct area(s).</p>
  const pct = (e) => {
    const r = ref.current.getBoundingClientRect()
    return { x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)) }
  }
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
  const down = (e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = pct(e); setDraft({ a: p, b: p }) }
  const move = (e) => draft && setDraft({ ...draft, b: pct(e) })
  const up = () => {
    if (!draft) return
    const r = rectOf(draft.a, draft.b)
    setDraft(null)
    if (r.w >= 1 && r.h >= 1 && q.regions.length < 5) {
      onChange({ regions: [...q.regions, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 100) / 100]))] })
    }
  }
  const shown = [...q.regions, ...(draft ? [rectOf(draft.a, draft.b)] : [])]
  return (
    <div>
      <span className={label}>Drag on the picture to mark the correct area (up to 5 areas)</span>
      <div className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <img ref={ref} src={mediaUrl(q.imageUrl)} alt="" draggable={false} onPointerDown={down} onPointerMove={move} onPointerUp={up} className="block max-h-96 w-auto max-w-full cursor-crosshair" />
        {shown.map((r, i) => (
          <div key={i} className="pointer-events-none absolute border-2 border-emerald-500 bg-emerald-400/25" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {q.regions.map((_, i) => (
          <button key={i} type="button" onClick={() => onChange({ regions: q.regions.filter((__, ri) => ri !== i) })} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-rose-50 hover:text-rose-600">
            Area {i + 1} <X className="h-3 w-3" />
          </button>
        ))}
        {q.regions.length === 0 && <span className="text-[11px] text-amber-600">No area marked yet.</span>}
      </div>
    </div>
  )
}
