import { useMemo } from 'react'
import { ChevronUp, ChevronDown, Check } from 'lucide-react'
import MathText, { Tex } from '../math/MathText'
import MathField from '../math/MathField'
import QuestionImage from './QuestionImage'
import HotspotPicker from './HotspotPicker'
import { BLANK_RE } from '../../utils/questionTypes'
import { plainToTex } from '../../utils/mathSplit'
export default function QuestionRenderer({ q, value, onChange, readOnly = false }) {
  const cfg = q.config || {}
  const set = readOnly ? () => {} : onChange
  const hotspot = q.type === 'hotspot'

  return (
    <div>
      {q.type === 'fill_blank'
        ? <FillBlankStem q={q} value={value} onChange={set} readOnly={readOnly} />
        : <MathText as="p" text={q.text} className="text-sm font-medium leading-relaxed text-slate-900 dark:text-white" />}

      {!hotspot && q.image_url && <QuestionImage src={q.image_url} alt={cfg.image_alt} className="mt-3" />}

      <div className="mt-5 space-y-2">
        {(q.type === 'mcq' || q.type === 'tf') && (q.options || []).map((opt) => (
          <ChoiceRow key={opt} label={opt} selected={value === opt} onClick={() => set(opt)} disabled={readOnly} />
        ))}

        {q.type === 'msq' && <MultiSelect q={q} value={value} onChange={set} readOnly={readOnly} />}

        {(q.type === 'short' || q.type === 'essay') && (
          <WrittenAnswer q={q} value={value} onChange={set} readOnly={readOnly} />
        )}

        {q.type === 'numeric' && (
          <div className="flex items-center gap-2">
            <input
              type="text" inputMode="decimal" autoComplete="off" disabled={readOnly}
              value={value ?? ''} onChange={(e) => set(e.target.value)}
              placeholder="Type a number, e.g. 3.14 or 1/3"
              className="input max-w-xs" aria-label="Numeric answer"
            />
            {cfg.unit && <span className="text-sm font-semibold text-slate-500">{cfg.unit}</span>}
          </div>
        )}

        {q.type === 'math_expr' && <MathExprAnswer q={q} value={value} onChange={set} readOnly={readOnly} />}

        {q.type === 'matrix' && <MatrixAnswer q={q} value={value} onChange={set} readOnly={readOnly} />}

        {q.type === 'matching' && <MatchingAnswer q={q} value={value} onChange={set} readOnly={readOnly} />}

        {q.type === 'ordering' && <OrderingAnswer q={q} value={value} onChange={set} readOnly={readOnly} />}

        {hotspot && (
          <HotspotPicker
            src={q.image_url} alt={cfg.image_alt} point={value}
            onPick={readOnly ? undefined : (pt) => set(pt)}
          />
        )}
      </div>
    </div>
  )
}

export function ChoiceRow({ label, selected, onClick, multi = false, disabled = false }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} role={multi ? 'checkbox' : 'radio'} aria-checked={!!selected}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
        selected
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400'
          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      } ${disabled ? 'cursor-default' : ''}`}
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center border-2 ${multi ? 'rounded' : 'rounded-full'} ${selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300 dark:border-slate-600'}`}>
        {selected && (multi ? <Check className="h-3 w-3 text-white" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-white" />)}
      </span>
      <MathText text={label} />
    </button>
  )
}

function MultiSelect({ q, value, onChange, readOnly }) {
  const chosen = Array.isArray(value) ? value : []
  const toggle = (opt) => onChange(chosen.includes(opt) ? chosen.filter((x) => x !== opt) : [...chosen, opt])
  return (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Select all that apply</p>
      {(q.options || []).map((opt) => (
        <ChoiceRow key={opt} multi label={opt} selected={chosen.includes(opt)} onClick={() => toggle(opt)} disabled={readOnly} />
      ))}
    </>
  )
}

function WrittenAnswer({ q, value, onChange, readOnly }) {
  const text = value ?? ''
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const max = q.config?.max_words
  const over = max && words > max
  return (
    <div>
      <MathField
        multiline rows={q.type === 'essay' ? 12 : 7} value={text} onChange={onChange} disabled={readOnly}
        placeholder="Type your answer…  Use “Math symbols” for ∀ ∃ ∧ ∨ → and matrices; wrap formulas in $…$"
        ariaLabel="Your answer"
      />
      {q.type === 'essay' && (
        <p className={`mt-1 text-right text-[11px] ${over ? 'font-semibold text-rose-600' : 'text-slate-400'}`}>
          {words}{max ? ` / ${max}` : ''} words{over ? ' — over the limit' : ''}
        </p>
      )}
    </div>
  )
}

function FillBlankStem({ q, value, onChange, readOnly }) {
  const answers = Array.isArray(value) ? value : []
  const pieces = useMemo(() => {
    const out = []
    let last = 0
    for (const m of q.text.matchAll(BLANK_RE)) {
      out.push({ text: q.text.slice(last, m.index) })
      out.push({ blank: Number(m[1]) })
      last = m.index + m[0].length
    }
    out.push({ text: q.text.slice(last) })
    return out
  }, [q.text])
  const setBlank = (n, v) => {
    const next = [...answers]
    while (next.length < (q.config?.blank_count || n)) next.push('')
    next[n - 1] = v
    onChange(next)
  }
  return (
    <div className="text-sm font-medium leading-loose text-slate-900 dark:text-white">
      {pieces.map((p, i) => p.blank ? (
        <input
          key={i} type="text" value={answers[p.blank - 1] ?? ''} disabled={readOnly} autoComplete="off"
          onChange={(e) => setBlank(p.blank, e.target.value)} aria-label={`Blank ${p.blank}`}
          className="mx-1 inline-block w-36 rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-800"
        />
      ) : <MathText key={i} text={p.text} />)}
    </div>
  )
}

function MathExprAnswer({ q, value, onChange, readOnly }) {
  const text = value ?? ''
  const vars = q.config?.variables || []
  return (
    <div className="space-y-1.5">
      <MathField
        value={text} onChange={onChange} disabled={readOnly} preview={false}
        groups={['Algebra', 'Greek']} placeholder="e.g. 3x^2 + 2x - 1"
        ariaLabel="Math expression answer"
      />
      <p className="text-[11px] text-slate-400">
        Use ^ for powers, sqrt(x), pi, sin(x), ln(x) and * or a space for multiply.
        {vars.length > 0 && <> Variable{vars.length > 1 ? 's' : ''}: <b>{vars.join(', ')}</b>.</>} Equivalent forms are accepted.
      </p>
      {text.trim() && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">We read this as</span>
          <Tex tex={plainToTex(text)} />
        </div>
      )}
    </div>
  )
}

function MatrixAnswer({ q, value, onChange, readOnly }) {
  const { rows = 2, cols = 2, row_labels: rl = [], col_labels: cl = [] } = q.config || {}
  const grid = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => value?.[i]?.[j] ?? ''))
  const setCell = (i, j, v) => onChange(grid.map((r, ri) => r.map((c, ci) => (ri === i && ci === j ? v : c))))
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1">
        {cl.length > 0 && (
          <thead>
            <tr>
              {rl.length > 0 && <th />}
              {cl.map((c, j) => <th key={j} className="px-1 text-center text-xs font-semibold text-slate-500"><MathText text={c} /></th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {grid.map((row, i) => (
            <tr key={i}>
              {rl.length > 0 && <th className="pr-1 text-right text-xs font-semibold text-slate-500"><MathText text={rl[i]} /></th>}
              {row.map((cell, j) => (
                <td key={j}>
                  <input
                    type="text" value={cell} disabled={readOnly} autoComplete="off" inputMode="text"
                    onChange={(e) => setCell(i, j, e.target.value)} aria-label={`Row ${i + 1} column ${j + 1}`}
                    className="h-9 w-16 rounded-md border border-slate-300 bg-slate-50 px-1 text-center text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-slate-400">Numbers may be fractions (1/2) or decimals. For truth tables use T / F.</p>
    </div>
  )
}

function MatchingAnswer({ q, value, onChange, readOnly }) {
  const { left = [], right = [] } = q.config || {}
  const current = value && typeof value === 'object' ? value : {}
  return (
    <div className="space-y-2">
      {left.map((l) => (
        <div key={l.id} className="flex flex-col gap-1.5 rounded-lg border border-slate-200 p-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
          <span className="text-sm text-slate-800 dark:text-slate-100"><MathText text={l.text} /></span>
          <select
            value={current[l.id] ?? ''} disabled={readOnly} aria-label={`Match for ${l.text}`}
            onChange={(e) => onChange({ ...current, [l.id]: e.target.value })}
            className="input sm:max-w-[55%]"
          >
            <option value="">— choose —</option>
            {right.map((r) => <option key={r.id} value={r.id}>{r.text}</option>)}
          </select>
        </div>
      ))}
    </div>
  )
}

function OrderingAnswer({ q, value, onChange, readOnly }) {
  const items = q.config?.items || []
  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  const touched = Array.isArray(value) && value.length === items.length
  const order = touched ? value : items.map((i) => i.id)   
  const move = (idx, dir) => {
    const next = [...order]
    const j = idx + dir
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    onChange(next)
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Use the arrows to put the items in the correct order</p>
      {order.map((id, idx) => (
        <div key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{idx + 1}</span>
          <span className="flex-1 text-slate-800 dark:text-slate-100"><MathText text={byId[id]?.text ?? id} /></span>
          {!readOnly && (
            <span className="flex gap-1">
              <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up" className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronUp className="h-4 w-4" /></button>
              <button type="button" onClick={() => move(idx, 1)} disabled={idx === order.length - 1} aria-label="Move down" className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"><ChevronDown className="h-4 w-4" /></button>
            </span>
          )}
        </div>
      ))}
      {!readOnly && !touched && (
        <button type="button" onClick={() => onChange(order)} className="text-xs font-semibold text-brand-600 hover:underline">
          Keep this order as my answer
        </button>
      )}
    </div>
  )
}
