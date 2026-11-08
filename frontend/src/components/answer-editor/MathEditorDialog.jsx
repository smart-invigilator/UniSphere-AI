import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Keyboard, Trash2, X } from 'lucide-react'
import { renderMathSafe } from './mathRender'
import { LIMITS } from './schema'

let mathliveReady = null
function loadMathLive() {
  if (!mathliveReady) {
    mathliveReady = import('mathlive').then((mod) => {
      mod.MathfieldElement.fontsDirectory = null
      mod.MathfieldElement.soundsDirectory = null
      document.body.style.setProperty('--keyboard-zindex', '2000')
      return mod
    })
  }
  return mathliveReady
}

const USER_INPUT_WINDOW_MS = 1500

const TEMPLATES = [
  { label: 'a/b', insert: '\\frac{#@}{#?}' },
  { label: '√', insert: '\\sqrt{#@}' },
  { label: 'ⁿ√', insert: '\\sqrt[#?]{#@}' },
  { label: 'xⁿ', insert: '#@^{#?}' },
  { label: 'xₙ', insert: '#@_{#?}' },
  { label: 'Σ', insert: '\\sum_{#?}^{#?}' },
  { label: '∫', insert: '\\int_{#?}^{#?}' },
  { label: 'lim', insert: '\\lim_{#?\\to#?}' },
  { label: '[2×2]', insert: '\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}' },
  { label: '[3×3]', insert: '\\begin{bmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{bmatrix}' },
  { label: '∀', insert: '\\forall' },
  { label: '∃', insert: '\\exists' },
  { label: '∈', insert: '\\in' },
  { label: '⊆', insert: '\\subseteq' },
  { label: '∪', insert: '\\cup' },
  { label: '∩', insert: '\\cap' },
  { label: '¬', insert: '\\neg' },
  { label: '∧', insert: '\\land' },
  { label: '∨', insert: '\\lor' },
  { label: '→', insert: '\\rightarrow' },
  { label: '⇔', insert: '\\iff' },
  { label: '≤', insert: '\\le' },
  { label: '≥', insert: '\\ge' },
  { label: '≠', insert: '\\ne' },
  { label: '∞', insert: '\\infty' },
  { label: 'π', insert: '\\pi' },
  { label: 'θ', insert: '\\theta' },
  { label: 'λ', insert: '\\lambda' },
]

export default function MathEditorDialog({ initialLatex, display, onSave, onCancel, onDelete }) {
  const hostRef = useRef(null)
  const fieldRef = useRef(null)
  const fromFieldRef = useRef(false)
  const syncingFieldRef = useRef(false)
  const programmaticValueRef = useRef(null)
  const lastUserInputRef = useRef(0)
  const dialogRef = useRef(null)
  const [latex, setLatex] = useState(initialLatex || '')
  const [loadError, setLoadError] = useState(null)
  const preview = latex.trim() ? renderMathSafe(latex, display) : null

  useEffect(() => {
    let cancelled = false
    dialogRef.current?.focus()
    loadMathLive()
      .then(({ MathfieldElement }) => {
        if (cancelled || !hostRef.current) return
        const mf = new MathfieldElement()
        mf.value = initialLatex || ''
        programmaticValueRef.current = mf.getValue('latex')
        mf.mathVirtualKeyboardPolicy = 'manual'
        mf.smartFence = true
        mf.setAttribute('aria-label', display ? 'Display equation editor' : 'Inline equation editor')
        mf.className = 'ae-mathfield'
        const markUser = () => {
          lastUserInputRef.current = performance.now()
        }
        ;['keydown', 'beforeinput', 'pointerdown', 'paste', 'cut', 'drop'].forEach((type) => mf.addEventListener(type, markUser, true))
        mf.addEventListener('input', () => {
          if (syncingFieldRef.current || !mf.hasFocus()) return
          if (performance.now() - lastUserInputRef.current > USER_INPUT_WINDOW_MS) return
          const next = mf.getValue('latex')
          if (next === programmaticValueRef.current) return
          programmaticValueRef.current = null
          fromFieldRef.current = true
          setLatex(next)
        })
        hostRef.current.appendChild(mf)
        fieldRef.current = mf
        const active = document.activeElement
        if (!active || active === document.body || active === dialogRef.current) mf.focus()
      })
      .catch(() => setLoadError('The visual equation editor could not load. You can still type LaTeX below.'))
    const onKeyboardPointer = (e) => {
      if (e.target instanceof Element && e.target.closest('.ML__keyboard, .ML__virtual-keyboard, math-virtual-keyboard')) {
        lastUserInputRef.current = performance.now()
      }
    }
    document.addEventListener('pointerdown', onKeyboardPointer, true)
    return () => {
      cancelled = true
      document.removeEventListener('pointerdown', onKeyboardPointer, true)
      fieldRef.current?.remove()
      window.mathVirtualKeyboard?.hide?.()
    }
  }, [])

  const onSourceChange = (value) => {
    fromFieldRef.current = false
    setLatex(value)
    const mf = fieldRef.current
    if (mf && mf.getValue('latex') !== value) {
      syncingFieldRef.current = true
      try {
        mf.setValue(value, { silenceNotifications: true })
        programmaticValueRef.current = mf.getValue('latex')
      } finally {
        syncingFieldRef.current = false
      }
    }
  }

  const insertTemplate = (insert) => {
    const mf = fieldRef.current
    if (!mf) {
      onSourceChange(`${latex}${insert.replace(/#[@?]/g, '')}`)
      return
    }
    mf.focus()
    mf.executeCommand(['insert', insert, { selectionMode: 'placeholder' }])
    programmaticValueRef.current = null
    fromFieldRef.current = true
    setLatex(mf.getValue('latex'))
  }

  const save = () => onSave(latex.slice(0, LIMITS.latex))

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape' && e.target.tagName !== 'MATH-FIELD') {
      e.preventDefault()
      onCancel()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={display ? 'Edit display equation' : 'Edit inline equation'}
        onKeyDown={onKeyDown}
        className="ae-dialog w-full max-w-2xl rounded-2xl outline-none border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{display ? 'Display equation' : 'Equation'}</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Equation templates">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertTemplate(t.insert)}
              className="min-w-[2rem] rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs text-slate-700 hover:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              fieldRef.current?.focus()
              window.mathVirtualKeyboard?.show?.()
            }}
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-600 dark:text-slate-300"
          >
            <Keyboard className="h-3.5 w-3.5" /> Keyboard
          </button>
        </div>

        <div ref={hostRef} className="mt-3 rounded-lg border border-slate-300 bg-white px-2 py-1 text-lg dark:border-slate-600 dark:bg-slate-800" />
        {loadError && <p className="mt-1 text-xs text-amber-600">{loadError}</p>}

        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-400" htmlFor="ae-latex-source">
          LaTeX source
        </label>
        <textarea
          id="ae-latex-source"
          value={latex}
          maxLength={LIMITS.latex}
          spellCheck={false}
          rows={2}
          onChange={(e) => onSourceChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />

        <div className="ae-dialog-preview mt-2 min-h-[2.5rem] overflow-x-auto rounded-lg border border-dashed border-slate-200 px-3 py-2 dark:border-slate-700" aria-live="polite">
          {!preview ? (
            <span className="text-xs text-slate-400">Preview appears here</span>
          ) : preview.error ? (
            <span className="text-xs font-medium text-rose-600">Cannot render: {preview.error}. Your LaTeX is kept exactly as typed.</span>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: preview.html }} />
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {onDelete ? (
            <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-500">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:text-slate-300">
              Cancel
            </button>
            <button type="button" onClick={save} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500">
              Save equation <span className="opacity-60">(Ctrl+Enter)</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}