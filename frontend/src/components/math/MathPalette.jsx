import { useState } from 'react'
const GROUPS = [
  { name: 'Logic', items: ['∀', '∃', '∄', '¬', '∧', '∨', '⊕', '→', '↔', '⇒', '⇔', '⊢', '⊨', '∴', '∵', '⊤', '⊥'] },
  { name: 'Sets', items: ['∈', '∉', '⊂', '⊆', '⊄', '∪', '∩', '∅', '∖', 'ℕ', 'ℤ', 'ℚ', 'ℝ', 'ℂ', '𝒫', '×'] },
  { name: 'Relations', items: ['≤', '≥', '≠', '≈', '≡', '≅', '∼', '∝', '∣', '∤', '≪', '≫', '≺', '≻'] },
  { name: 'Algebra', items: ['±', '÷', '√', '∛', '²', '³', 'ⁿ', '∞', '∑', '∏', '∫', '∂', '∇', '∆', '′', '⌈', '⌉', '⌊', '⌋', '⟨', '⟩', '‖'] },
  { name: 'Greek', items: ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'λ', 'μ', 'π', 'ρ', 'σ', 'τ', 'φ', 'ω', 'Δ', 'Σ', 'Ω', 'Π', 'Φ', 'Γ'] },
  {
    name: 'Templates',
    items: [
      { label: 'a⁄b', insert: '$\\frac{a}{b}$' },
      { label: 'xⁿ', insert: '$x^{n}$' },
      { label: 'xₙ', insert: '$x_{n}$' },
      { label: '√', insert: '$\\sqrt{x}$' },
      { label: '∑', insert: '$\\sum_{i=1}^{n} i$' },
      { label: '∫', insert: '$\\int_{a}^{b} f(x)\\,dx$' },
      { label: 'lim', insert: '$\\lim_{x \\to 0} f(x)$' },
      { label: '2×2', insert: '$\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}$' },
      { label: '3×3', insert: '$\\begin{bmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{bmatrix}$' },
      { label: 'det', insert: '$\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}$' },
      { label: 'cases', insert: '$\\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}$' },
      { label: '$…$', insert: '$$' , caret: 1 },
    ],
  },
]

export default function MathPalette({ onInsert, groups, className = '' }) {
  const list = groups ? GROUPS.filter((g) => groups.includes(g.name)) : GROUPS
  const [open, setOpen] = useState(list[0]?.name)
  const active = list.find((g) => g.name === open) || list[0]
  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60 ${className}`}>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {list.map((g) => (
          <button
            key={g.name} type="button" onClick={() => setOpen(g.name)}
            className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
              g.name === active.name ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >{g.name}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {active.items.map((it) => {
          const item = typeof it === 'string' ? { label: it, insert: it } : it
          return (
            <button
              key={item.label} type="button" title={item.insert}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsert(item.insert, item.caret)}
              className="min-w-[1.9rem] rounded border border-slate-200 bg-white px-1.5 py-1 text-sm text-slate-700 hover:border-brand-400 hover:bg-brand-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >{item.label}</button>
          )
        })}
      </div>
    </div>
  )
}

export function insertAtCaret(el, current, text, onChange, caretBack = 0) {
  const value = String(current ?? '')
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? value.length
  const next = value.slice(0, start) + text + value.slice(end)
  onChange(next)
  if (el) {
    const pos = start + text.length - caretBack
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos) })
  }
}
