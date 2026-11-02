import { useRef, useState } from 'react'
import { Sigma, Eye, EyeOff } from 'lucide-react'
import MathText, { LatexBlock } from './MathText'

const C = '§'

export const SYMBOL_GROUPS = [
  {
    id: 'basic',
    label: 'Basic',
    items: [
      { d: '+', l: '+', u: '+' },
      { d: '−', l: '-', u: '−' },
      { d: '×', l: '\\times ', u: '×' },
      { d: '÷', l: '\\div ', u: '÷' },
      { d: '·', l: '\\cdot ', u: '·' },
      { d: '±', l: '\\pm ', u: '±' },
      { d: '=', l: '=', u: '=' },
      { d: '≠', l: '\\neq ', u: '≠' },
      { d: '≈', l: '\\approx ', u: '≈' },
      { d: '<', l: '<', u: '<' },
      { d: '>', l: '>', u: '>' },
      { d: '≤', l: '\\leq ', u: '≤' },
      { d: '≥', l: '\\geq ', u: '≥' },
      { d: 'a/b', l: `\\frac{${C}}{}`, t: true },
      { d: '√x', l: `\\sqrt{${C}}`, t: true },
      { d: 'ⁿ√x', l: `\\sqrt[${C}]{}`, t: true },
      { d: 'x²', l: '^{2}', u: '²' },
      { d: 'xⁿ', l: `^{${C}}`, t: true },
      { d: 'xₙ', l: `_{${C}}`, t: true },
      { d: '|x|', l: `\\left|${C}\\right|`, t: true },
      { d: '( )', l: `\\left(${C}\\right)`, t: true },
      { d: 'π', l: '\\pi ', u: 'π' },
      { d: '∞', l: '\\infty ', u: '∞' },
      { d: '°', l: '^{\\circ}', u: '°' },
      { d: '%', l: '\\%', u: '%' },
      { d: 'n!', l: '!', u: '!' },
      { d: 'nCr', l: `\\binom{${C}}{}`, t: true },
    ],
  },
  {
    id: 'logic',
    label: 'Logic',
    items: [
      { d: '∀', l: '\\forall ', u: '∀' },
      { d: '∃', l: '\\exists ', u: '∃' },
      { d: '∄', l: '\\nexists ', u: '∄' },
      { d: '¬', l: '\\neg ', u: '¬' },
      { d: '∧', l: '\\land ', u: '∧' },
      { d: '∨', l: '\\lor ', u: '∨' },
      { d: '⊕', l: '\\oplus ', u: '⊕' },
      { d: '→', l: '\\to ', u: '→' },
      { d: '↔', l: '\\leftrightarrow ', u: '↔' },
      { d: '⇒', l: '\\implies ', u: '⇒' },
      { d: '⇔', l: '\\iff ', u: '⇔' },
      { d: '≡', l: '\\equiv ', u: '≡' },
      { d: '⊤', l: '\\top ', u: '⊤' },
      { d: '⊥', l: '\\bot ', u: '⊥' },
      { d: '∴', l: '\\therefore ', u: '∴' },
      { d: '∵', l: '\\because ', u: '∵' },
      { d: '⊢', l: '\\vdash ', u: '⊢' },
      { d: '⊨', l: '\\models ', u: '⊨' },
      { d: '∣', l: '\\mid ', u: '∣' },
      { d: '⌊x⌋', l: `\\lfloor ${C}\\rfloor`, t: true },
      { d: '⌈x⌉', l: `\\lceil ${C}\\rceil`, t: true },
      { d: 'mod', l: '\\bmod ', u: ' mod ' },
    ],
  },
  {
    id: 'sets',
    label: 'Sets',
    items: [
      { d: '∈', l: '\\in ', u: '∈' },
      { d: '∉', l: '\\notin ', u: '∉' },
      { d: '⊂', l: '\\subset ', u: '⊂' },
      { d: '⊆', l: '\\subseteq ', u: '⊆' },
      { d: '⊄', l: '\\not\\subset ', u: '⊄' },
      { d: '⊃', l: '\\supset ', u: '⊃' },
      { d: '⊇', l: '\\supseteq ', u: '⊇' },
      { d: '∪', l: '\\cup ', u: '∪' },
      { d: '∩', l: '\\cap ', u: '∩' },
      { d: '∖', l: '\\setminus ', u: '∖' },
      { d: '∅', l: '\\emptyset ', u: '∅' },
      { d: 'Aᶜ', l: '^{c}', u: 'ᶜ' },
      { d: '𝒫(A)', l: `\\mathcal{P}(${C})`, t: true },
      { d: '{ }', l: `\\{${C}\\}`, t: true },
      { d: '{x | }', l: `\\{x \\mid ${C}\\}`, t: true },
      { d: 'ℕ', l: '\\mathbb{N}', u: 'ℕ' },
      { d: 'ℤ', l: '\\mathbb{Z}', u: 'ℤ' },
      { d: 'ℚ', l: '\\mathbb{Q}', u: 'ℚ' },
      { d: 'ℝ', l: '\\mathbb{R}', u: 'ℝ' },
      { d: 'ℂ', l: '\\mathbb{C}', u: 'ℂ' },
      { d: '⋃', l: `\\bigcup_{${C}}`, t: true },
      { d: '⋂', l: `\\bigcap_{${C}}`, t: true },
    ],
  },
  {
    id: 'calculus',
    label: 'Calculus',
    items: [
      { d: '∑', l: `\\sum_{${C}}^{}`, t: true },
      { d: '∏', l: `\\prod_{${C}}^{}`, t: true },
      { d: '∫', l: '\\int ', u: '∫' },
      { d: '∫ₐᵇ', l: `\\int_{${C}}^{}`, t: true },
      { d: '∬', l: '\\iint ', u: '∬' },
      { d: '∮', l: '\\oint ', u: '∮' },
      { d: 'lim', l: `\\lim_{${C} \\to }`, t: true },
      { d: 'd/dx', l: '\\frac{d}{dx}', t: true },
      { d: '∂', l: '\\partial ', u: '∂' },
      { d: '∇', l: '\\nabla ', u: '∇' },
      { d: 'Δ', l: '\\Delta ', u: 'Δ' },
      { d: "f'", l: "'", u: '′' },
      { d: 'eˣ', l: `e^{${C}}`, t: true },
      { d: 'log', l: '\\log ', u: 'log ' },
      { d: 'ln', l: '\\ln ', u: 'ln ' },
      { d: 'sin', l: '\\sin ', u: 'sin ' },
      { d: 'cos', l: '\\cos ', u: 'cos ' },
      { d: 'tan', l: '\\tan ', u: 'tan ' },
    ],
  },
  {
    id: 'linalg',
    label: 'Linear Algebra',
    items: [
      { d: '[2×2]', l: `\\begin{bmatrix} ${C} & \\\\  &  \\end{bmatrix}`, t: true },
      { d: '[3×3]', l: `\\begin{bmatrix} ${C} &  & \\\\  &  & \\\\  &  &  \\end{bmatrix}`, t: true },
      { d: '(2×2)', l: `\\begin{pmatrix} ${C} & \\\\  &  \\end{pmatrix}`, t: true },
      { d: '|2×2|', l: `\\begin{vmatrix} ${C} & \\\\  &  \\end{vmatrix}`, t: true },
      { d: '|3×3|', l: `\\begin{vmatrix} ${C} &  & \\\\  &  & \\\\  &  &  \\end{vmatrix}`, t: true },
      { d: 'col vec', l: `\\begin{bmatrix} ${C} \\\\  \\\\  \\end{bmatrix}`, t: true },
      { d: 'v⃗', l: `\\vec{${C}}`, t: true },
      { d: 'Aᵀ', l: '^{T}', u: 'ᵀ' },
      { d: 'A⁻¹', l: '^{-1}', u: '⁻¹' },
      { d: '‖v‖', l: `\\|${C}\\|`, t: true },
      { d: '⟨u,v⟩', l: `\\langle ${C} \\rangle`, t: true },
      { d: '⊗', l: '\\otimes ', u: '⊗' },
      { d: '⊥', l: '\\perp ', u: '⊥' },
      { d: 'det', l: '\\det ', u: 'det ' },
      { d: 'tr', l: '\\operatorname{tr}', u: 'tr ' },
      { d: 'rank', l: '\\operatorname{rank}', u: 'rank ' },
      { d: 'Iₙ', l: 'I_{n}', u: 'Iₙ' },
      { d: '⋯', l: '\\cdots ', u: '⋯' },
      { d: '⋮', l: '\\vdots ', u: '⋮' },
      { d: '⋱', l: '\\ddots ', u: '⋱' },
      { d: 'λ', l: '\\lambda ', u: 'λ' },
    ],
  },
  {
    id: 'greek',
    label: 'Greek',
    items: [
      ['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'], ['θ', 'theta'],
      ['λ', 'lambda'], ['μ', 'mu'], ['π', 'pi'], ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'], ['φ', 'phi'],
      ['ω', 'omega'], ['Γ', 'Gamma'], ['Δ', 'Delta'], ['Θ', 'Theta'], ['Λ', 'Lambda'], ['Σ', 'Sigma'],
      ['Φ', 'Phi'], ['Ω', 'Omega'],
    ].map(([d, n]) => ({ d, l: `\\${n} `, u: d })),
  },
]

function insertionFor(item, mode) {
  if (mode === 'latex') return item.l
  if (mode === 'text' && item.u && !item.t) return item.u
  return `$${item.l}$`
}

export function MathToolbar({ onInsert, mode = 'latex', groups }) {
  const visible = groups ? SYMBOL_GROUPS.filter((g) => groups.includes(g.id)) : SYMBOL_GROUPS
  const [active, setActive] = useState(visible[0]?.id)
  const group = visible.find((g) => g.id === active) || visible[0]
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex flex-wrap gap-1">
        {visible.map((g) => (
          <button
            key={g.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActive(g.id)}
            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
              g.id === group?.id
                ? 'bg-brand-600 text-white'
                : 'text-slate-500 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {group?.items.map((item) => (
          <button
            key={item.d + item.l}
            type="button"
            title={item.l.replace(C, '')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(insertionFor(item, mode))}
            className="min-w-[2rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 hover:border-brand-400 hover:text-brand-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            {item.d}
          </button>
        ))}
      </div>
    </div>
  )
}

export function insertAtCursor(el, value, snippet) {
  const start = el ? el.selectionStart ?? value.length : value.length
  const end = el ? el.selectionEnd ?? value.length : value.length
  const markerIdx = snippet.indexOf(C)
  const clean = snippet.replace(C, '')
  const next = value.slice(0, start) + clean + value.slice(end)
  const caret = start + (markerIdx >= 0 ? markerIdx : clean.length)
  return { next, caret }
}

export default function MathInput({
  value,
  onChange,
  mode = 'text',
  rows = 4,
  placeholder,
  disabled = false,
  showPreview = 'auto',
  groups,
  singleLine = false,
  maxLength,
  className = '',
}) {
  const ref = useRef(null)
  const [open, setOpen] = useState(mode === 'latex')
  const [preview, setPreview] = useState(true)
  const v = value ?? ''

  const insert = (snippet) => {
    if (disabled) return
    const { next, caret } = insertAtCursor(ref.current, v, snippet)
    if (maxLength && next.length > maxLength) return
    onChange(next)
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus()
        ref.current.setSelectionRange(caret, caret)
      }
    })
  }

  const hasMath = mode === 'latex' ? v.trim().length > 0 : /\$[^$]+\$|\\\(|\\\[/.test(v)
  const previewOn = showPreview === true || (showPreview === 'auto' && hasMath)
  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white'

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:hover:bg-brand-500/10"
        >
          <Sigma className="h-3.5 w-3.5" /> {open ? 'Hide math symbols' : 'Math symbols'}
        </button>
        {previewOn && (
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600"
          >
            {preview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} {preview ? 'Hide preview' : 'Show preview'}
          </button>
        )}
      </div>
      {open && !disabled && <MathToolbar onInsert={insert} mode={mode} groups={groups} />}
      {singleLine ? (
        <input
          ref={ref}
          value={v}
          disabled={disabled}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={mode !== 'latex'}
          className={`${inputClass} ${mode === 'latex' ? 'font-mono' : ''}`}
        />
      ) : (
        <textarea
          ref={ref}
          rows={rows}
          value={v}
          disabled={disabled}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={mode !== 'latex'}
          className={`${inputClass} ${mode === 'latex' ? 'font-mono' : ''}`}
        />
      )}
      {previewOn && preview && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-100">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Preview</p>
          {mode === 'latex' ? <LatexBlock latex={v} /> : <MathText text={v} />}
        </div>
      )}
    </div>
  )
}