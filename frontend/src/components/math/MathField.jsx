import { useRef, useState } from 'react'
import { Sigma } from 'lucide-react'
import MathPalette, { insertAtCaret } from './MathPalette'
import MathText from './MathText'
export default function MathField({
  value, onChange, multiline = false, rows = 6, placeholder, palette = true,
  groups, preview = true, className = '', disabled = false, maxLength, ariaLabel,
}) {
  const ref = useRef(null)
  const [showPalette, setShowPalette] = useState(false)
  const text = value ?? ''
  const base = 'w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
  const common = {
    ref, value: text, disabled, placeholder, maxLength, 'aria-label': ariaLabel,
    onChange: (e) => onChange(e.target.value), className: `${base} ${className}`,
  }
  return (
    <div className="space-y-1.5">
      {multiline ? <textarea rows={rows} {...common} /> : <input type="text" {...common} />}
      {palette && !disabled && (
        <div>
          <button
            type="button" onClick={() => setShowPalette((s) => !s)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline"
          >
            <Sigma className="h-3.5 w-3.5" /> {showPalette ? 'Hide symbols' : 'Math symbols'}
          </button>
          {showPalette && (
            <MathPalette
              groups={groups} className="mt-1"
              onInsert={(t, caret) => insertAtCaret(ref.current, text, t, onChange, caret ? caret : 0)}
            />
          )}
        </div>
      )}
      {preview && text.includes('$') && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Preview</span>
          <MathText text={text} />
        </div>
      )}
    </div>
  )
}
