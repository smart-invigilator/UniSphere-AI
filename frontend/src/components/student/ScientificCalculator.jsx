import { useEffect, useMemo, useRef, useState } from 'react'
import { Calculator as CalculatorIcon, GripHorizontal, X } from 'lucide-react'
import { FUNCTION_NAMES, WORD_OPERATORS, formatNumber, safeEvaluate } from '../../utils/calculator'
const PANEL_WIDTH = 328

const STYLES = {
  num: 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600',
  fn: 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  op: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25',
  eq: 'bg-brand-600 text-white hover:bg-brand-700',
  danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25',
  active: 'bg-brand-600 text-white hover:bg-brand-700',
}
const ROWS = [
  [
    { id: 'second', type: 'second', label: '2nd', style: 'fn', aria: 'Second function' },
    { id: 'angle', type: 'angle', style: 'fn', aria: 'Toggle degrees / radians' },
    { id: 'lp', label: '(', insert: '(', kind: 'value', style: 'fn' },
    { id: 'rp', label: ')', insert: ')', kind: 'close', style: 'fn' },
    { id: 'ac', type: 'clear', label: 'AC', style: 'danger', aria: 'All clear' },
  ],
  [
    { id: 'sin', label: 'sin', alt: 'sin⁻¹', insert: 'sin(', altInsert: 'sin⁻¹(', kind: 'value', style: 'fn' },
    { id: 'cos', label: 'cos', alt: 'cos⁻¹', insert: 'cos(', altInsert: 'cos⁻¹(', kind: 'value', style: 'fn' },
    { id: 'tan', label: 'tan', alt: 'tan⁻¹', insert: 'tan(', altInsert: 'tan⁻¹(', kind: 'value', style: 'fn' },
    { id: 'pi', label: 'π', insert: 'π', kind: 'value', style: 'fn' },
    { id: 'e', label: 'e', insert: 'e', kind: 'value', style: 'fn' },
  ],
  [
    { id: 'sinh', label: 'sinh', alt: 'sinh⁻¹', insert: 'sinh(', altInsert: 'sinh⁻¹(', kind: 'value', style: 'fn' },
    { id: 'cosh', label: 'cosh', alt: 'cosh⁻¹', insert: 'cosh(', altInsert: 'cosh⁻¹(', kind: 'value', style: 'fn' },
    { id: 'tanh', label: 'tanh', alt: 'tanh⁻¹', insert: 'tanh(', altInsert: 'tanh⁻¹(', kind: 'value', style: 'fn' },
    { id: 'ln', label: 'ln', alt: 'eˣ', insert: 'ln(', altInsert: 'e^(', kind: 'value', style: 'fn' },
    { id: 'log', label: 'log', alt: '10ˣ', insert: 'log(', altInsert: '10^(', kind: 'value', style: 'fn' },
  ],
  [
    { id: 'sq', label: 'x²', alt: 'x³', insert: '²', altInsert: '³', kind: 'postfix', style: 'fn' },
    { id: 'pow', label: 'xʸ', alt: 'ʸ√x', insert: '^', altInsert: 'ʸ√', kind: 'binop', style: 'fn' },
    { id: 'sqrt', label: '√', alt: '∛', insert: '√(', altInsert: '∛(', kind: 'value', style: 'fn' },
    { id: 'inv', label: '1/x', alt: '|x|', insert: '^(−1)', altInsert: 'abs(', kind: 'postfix', altKind: 'value', style: 'fn' },
    { id: 'fact', label: 'n!', insert: '!', kind: 'postfix', style: 'fn' },
  ],
  [
    { id: 'ncr', label: 'nCr', insert: 'nCr', kind: 'binop', style: 'fn' },
    { id: 'npr', label: 'nPr', insert: 'nPr', kind: 'binop', style: 'fn' },
    { id: 'mod', label: 'mod', insert: 'mod', kind: 'binop', style: 'fn' },
    { id: 'exp', label: 'EXP', insert: 'E', kind: 'exp', style: 'fn', aria: 'Times ten to the power' },
    { id: 'back', type: 'back', label: '⌫', style: 'fn', aria: 'Backspace' },
  ],
  [
    { id: '7', label: '7', insert: '7', kind: 'num', style: 'num' },
    { id: '8', label: '8', insert: '8', kind: 'num', style: 'num' },
    { id: '9', label: '9', insert: '9', kind: 'num', style: 'num' },
    { id: 'div', label: '÷', insert: '÷', kind: 'binop', style: 'op' },
    { id: 'pct', label: '%', insert: '%', kind: 'postfix', style: 'op' },
  ],
  [
    { id: '4', label: '4', insert: '4', kind: 'num', style: 'num' },
    { id: '5', label: '5', insert: '5', kind: 'num', style: 'num' },
    { id: '6', label: '6', insert: '6', kind: 'num', style: 'num' },
    { id: 'mul', label: '×', insert: '×', kind: 'binop', style: 'op' },
    { id: 'ans', label: 'Ans', insert: 'Ans', kind: 'value', style: 'op' },
  ],
  [
    { id: '1', label: '1', insert: '1', kind: 'num', style: 'num' },
    { id: '2', label: '2', insert: '2', kind: 'num', style: 'num' },
    { id: '3', label: '3', insert: '3', kind: 'num', style: 'num' },
    { id: 'sub', label: '−', insert: '−', kind: 'binop', style: 'op' },
    { id: 'neg', type: 'negate', label: '±', style: 'op', aria: 'Change sign' },
  ],
  [
    { id: '0', label: '0', insert: '0', kind: 'num', style: 'num', span: true },
    { id: 'dot', label: '.', insert: '.', kind: 'num', style: 'num' },
    { id: 'add', label: '+', insert: '+', kind: 'binop', style: 'op' },
    { id: 'eq', type: 'equals', label: '=', style: 'eq', aria: 'Equals' },
  ],
]

const KEYS = ROWS.flat()
const SIMPLE_BINOPS = new Set(['+', '×', '÷', '^'])
const BACKSPACE_TOKENS = [...FUNCTION_NAMES.map((n) => `${n}(`), ...FUNCTION_NAMES, ...WORD_OPERATORS, 'Ans']
  .sort((a, b) => b.length - a.length)

function panelWidth() {
  return Math.min(PANEL_WIDTH, window.innerWidth - 16)
}

function clampPosition({ x, y }) {
  const width = panelWidth()
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 80)),
  }
}

export default function ScientificCalculator({ open, onClose }) {
  const [expr, setExpr] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [ans, setAns] = useState(0)
  const [angle, setAngle] = useState('deg')
  const [second, setSecond] = useState(false)
  const [pos, setPos] = useState(() => clampPosition({ x: window.innerWidth - PANEL_WIDTH - 16, y: 72 }))
  const [width, setWidth] = useState(() => panelWidth())

  const panelRef = useRef(null)
  const exprRef = useRef(null)
  const dragRef = useRef(null)


  useEffect(() => {
    const onResize = () => {
      setWidth(panelWidth())
      setPos((p) => clampPosition(p))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (exprRef.current) exprRef.current.scrollLeft = exprRef.current.scrollWidth
  }, [expr])

  const onDragStart = (e) => {
    if (e.target.closest('button')) return
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDragMove = (e) => {
    if (!dragRef.current) return
    setPos(clampPosition({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy }))
  }
  const onDragEnd = (e) => {
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }


  const clearAll = () => {
    setExpr('')
    setResult(null)
    setError(null)
    setDone(false)
  }

  const input = (text, kind) => {
    setError(null)
    let base = expr

    if (done) {
      if (kind === 'close' || kind === 'exp') return
      base = kind === 'binop' || kind === 'postfix' ? 'Ans' : ''
      setResult(null)
      setDone(false)
    }

    if (kind === 'exp' && !/\d$/.test(base)) return

    if (kind === 'num' && text === '.' && (base.match(/[\d.]*$/)?.[0] || '').includes('.')) return

    if (kind === 'binop' && base === '' && text !== '−' && text !== '+') base = 'Ans'

    let next = base + text
    if (kind === 'binop') {
      if (text === '−' && /[+−]$/.test(base)) next = base.slice(0, -1) + text
      else if (SIMPLE_BINOPS.has(text) && /[+−×÷^]$/.test(base)) next = base.slice(0, -1) + text
    }
    setExpr(next)
  }

  const backspace = () => {
    setError(null)
    setResult(null)
    setDone(false)
    const hit = BACKSPACE_TOKENS.find((token) => expr.endsWith(token))
    setExpr(expr.slice(0, expr.length - (hit ? hit.length : 1)))
  }

  const negate = () => {
    setError(null)
    let base = expr
    if (done) {
      base = 'Ans'
      setDone(false)
      setResult(null)
    }
    if (!base) { setExpr('−'); return }
    const wrapped = /\(−([^()]*)\)$/.exec(base)
    if (wrapped) { setExpr(base.slice(0, wrapped.index) + wrapped[1]); return }
    const operand = /(\d+\.?\d*(?:E[+\-−]?\d+)?|\.\d+|π|e|Ans)$/.exec(base)
    if (operand) setExpr(`${base.slice(0, operand.index)}(−${operand[0]})`)
    else setExpr(base)
  }

  const equals = () => {
    if (done || !expr.trim()) return
    const { value, error: err } = safeEvaluate(expr, { angle, ans })
    if (err) { setError(err); return }
    setAns(value)
    setResult(formatNumber(value))
    setDone(true)
  }

  const toggleAngle = () => {
    setAngle((a) => (a === 'deg' ? 'rad' : 'deg'))
    if (done) { setDone(false); setResult(null) }
  }

  const press = (key) => {
    switch (key.type) {
      case 'second': setSecond((s) => !s); return
      case 'angle': toggleAngle(); return
      case 'clear': clearAll(); return
      case 'back': backspace(); return
      case 'equals': equals(); return
      case 'negate': negate(); return
      default: {
        const alt = second && key.alt
        input(alt ? key.altInsert : key.insert, alt ? (key.altKind || key.kind) : key.kind)
        if (alt) setSecond(false)
      }
    }
  }

  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    let handled = true
    if (/^[0-9]$/.test(k)) input(k, 'num')
    else if (k === '.') input('.', 'num')
    else if (k === '+') input('+', 'binop')
    else if (k === '-') input('−', 'binop')
    else if (k === '*') input('×', 'binop')
    else if (k === '/') input('÷', 'binop')
    else if (k === '^') input('^', 'binop')
    else if (k === '(') input('(', 'value')
    else if (k === ')') input(')', 'close')
    else if (k === '!') input('!', 'postfix')
    else if (k === '%') input('%', 'postfix')
    else if (k === 'Enter' || k === '=') equals()
    else if (k === 'Backspace') backspace()
    else if (k === 'Delete') clearAll()
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }


  const preview = useMemo(() => {
    if (done || error || !expr || /^[\d.]+$/.test(expr)) return null
    const r = safeEvaluate(expr, { angle, ans })
    return r.error ? null : formatNumber(r.value)
  }, [expr, angle, ans, done, error])

  const mainLine = error || (done ? result : preview ?? (expr ? '' : '0'))

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Scientific calculator"
      aria-hidden={!open}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`${open ? 'flex' : 'hidden'} fixed z-40 select-none flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900`}
      style={{ left: pos.x, top: pos.y, width }}
    >
      {/* Drag handle + close */}
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        className="flex cursor-grab touch-none items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800/60"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
          <CalculatorIcon className="h-4 w-4 text-brand-600" /> Scientific Calculator
        </span>
        <span className="flex items-center gap-1">
          <GripHorizontal className="h-4 w-4 text-slate-300 dark:text-slate-600" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close calculator"
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>

      <div className="p-3">
        {/* Display */}
        <div className="mb-3 rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800" aria-live="polite">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <span className="rounded bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">{angle === 'deg' ? 'DEG' : 'RAD'}</span>
            {second && <span className="rounded bg-brand-600 px-1.5 py-0.5 text-white">2nd</span>}
          </div>
          <div
            ref={exprRef}
            className="mt-1 h-7 overflow-x-auto whitespace-nowrap text-right font-mono text-base text-slate-600 dark:text-slate-300 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {expr || '\u00A0'}
          </div>
          <div
            className={`h-9 overflow-x-auto whitespace-nowrap text-right font-mono text-2xl font-bold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
              error ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'
            }`}
          >
            {mainLine || '\u00A0'}
          </div>
        </div>

        {/* Keys */}
        <div className="grid grid-cols-5 gap-1.5">
          {KEYS.map((key) => {
            const showAlt = second && key.alt
            const label = key.type === 'angle' ? (angle === 'deg' ? 'DEG' : 'RAD') : showAlt ? key.alt : key.label
            const style = key.type === 'second' && second ? STYLES.active : STYLES[key.style]
            return (
              <button
                key={key.id}
                type="button"
                onClick={() => press(key)}
                aria-label={key.aria || label}
                aria-pressed={key.type === 'second' ? second : undefined}
                className={`relative h-9 rounded-lg text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-95 ${style} ${key.span ? 'col-span-2' : ''}`}
              >
                {label}
                {key.alt && (
                  <span className="pointer-events-none absolute right-1 top-0.5 text-[8px] font-medium leading-none text-slate-400 dark:text-slate-500">
                    {showAlt ? key.label : key.alt}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <p className="mt-2 text-center text-[10px] text-slate-400">
          Tip: click the calculator, then use your keyboard. Drag the title bar to move it.
        </p>
      </div>
    </div>
  )
}