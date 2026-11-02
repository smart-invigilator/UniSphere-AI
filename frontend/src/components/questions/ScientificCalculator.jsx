import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { create, all } from 'mathjs'
import { X, GripHorizontal, History, Delete } from 'lucide-react'

const math = create(all, { number: 'number', precision: 64 })
const RAD = Math.PI / 180

const VALUE_END = new Set(['num', 'const', 'close', 'postfix'])
const VALUE_START = new Set(['const', 'func', 'open'])

const tok = (kind, v, d = v) => ({ kind, v, d })
const T = {
  num: (n) => tok('num', n),
  op: (v, d) => tok('op', v, d),
  func: (v, d) => tok('func', v, d),
  const: (v, d) => tok('const', v, d),
  postfix: (v, d) => tok('postfix', v, d),
  open: () => tok('open', '(', '('),
  close: () => tok('close', ')', ')'),
  comma: () => tok('comma', ',', ','),
}

function buildExpression(tokens) {
  let out = ''
  let depth = 0
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1]
    if (prev && VALUE_END.has(prev.kind) && (VALUE_START.has(t.kind) || (t.kind === 'num' && prev.kind !== 'num'))) out += '*'
    out += t.v
    if (t.kind === 'func' || t.kind === 'open') depth += 1
    if (t.kind === 'close') depth = Math.max(0, depth - 1)
  })
  return out + ')'.repeat(depth)
}

function formatNumber(x) {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new Error('Math Error')
    const clean = Math.abs(x) < 1e-12 ? 0 : x
    return math.format(clean, { precision: 12, lowerExp: -9, upperExp: 15 })
  }
  if (x && typeof x === 'object' && x.isComplex) {
    if (!Number.isFinite(x.re) || !Number.isFinite(x.im)) throw new Error('Math Error')
    const re = Math.abs(x.re) < 1e-12 ? 0 : x.re
    const im = Math.abs(x.im) < 1e-12 ? 0 : x.im
    if (im === 0) return formatNumber(re)
    return math.format(math.complex(re, im), { precision: 10 })
  }
  if (typeof x === 'boolean') return x ? '1' : '0'
  throw new Error('Math Error')
}

function toNumber(x) {
  if (typeof x === 'number') return x
  if (x && x.isComplex && Math.abs(x.im) < 1e-12) return x.re
  return null
}

function isInt(n) {
  return Number.isInteger(n) && n >= 0
}

export default function ScientificCalculator({ open, onClose }) {
  const [tokens, setTokens] = useState([])
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [justEvaluated, setJustEvaluated] = useState(false)
  const [angle, setAngle] = useState('DEG')
  const [second, setSecond] = useState(false)
  const [ans, setAns] = useState(0)
  const [memory, setMemory] = useState(0)
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [pos, setPos] = useState(null)
  const panelRef = useRef(null)
  const dragRef = useRef(null)

  const scope = useMemo(() => {
    const base = {
      ans,
      nCr: (n, r) => {
        if (!isInt(n) || !isInt(r) || r > n) throw new Error('Math Error')
        return math.combinations(n, r)
      },
      nPr: (n, r) => {
        if (!isInt(n) || !isInt(r) || r > n) throw new Error('Math Error')
        return math.permutations(n, r)
      },
      logb: (x, b) => Math.log(x) / Math.log(b),
      root: (x, n) => {
        if (x < 0 && Number.isInteger(n) && n % 2 === 1) return -Math.pow(-x, 1 / n)
        return Math.pow(x, 1 / n)
      },
      fact: (n) => {
        if (!isInt(n) || n > 170) throw new Error('Math Error')
        return math.factorial(n)
      },
    }
    if (angle === 'DEG') {
      Object.assign(base, {
        sin: (x) => Math.sin(x * RAD),
        cos: (x) => Math.cos(x * RAD),
        tan: (x) => {
          if (Math.abs(((x % 180) + 180) % 180 - 90) < 1e-10) throw new Error('Math Error')
          return Math.tan(x * RAD)
        },
        asin: (x) => Math.asin(x) / RAD,
        acos: (x) => Math.acos(x) / RAD,
        atan: (x) => Math.atan(x) / RAD,
      })
    } else {
      Object.assign(base, {
        asin: (x) => Math.asin(x),
        acos: (x) => Math.acos(x),
      })
    }
    return base
  }, [angle, ans])

  const displayExpr = tokens.map((t) => t.d).join('')

  const evaluateTokens = useCallback(
    (list) => {
      if (!list.length) return null
      return math.evaluate(buildExpression(list), { ...scope })
    },
    [scope],
  )

  const preview = useMemo(() => {
    if (!tokens.length || justEvaluated) return ''
    try {
      return formatNumber(evaluateTokens(tokens))
    } catch {
      return ''
    }
  }, [tokens, justEvaluated, evaluateTokens])

  const push = useCallback(
    (t) => {
      setError('')
      if (justEvaluated) {
        setJustEvaluated(false)
        setResult('')
        setTokens(t.kind === 'op' || t.kind === 'postfix' ? [T.const('ans', 'Ans'), t] : [t])
        return
      }
      setTokens((prev) => (prev.length >= 200 ? prev : [...prev, t]))
    },
    [justEvaluated],
  )

  const clearAll = useCallback(() => {
    setTokens([])
    setResult('')
    setError('')
    setJustEvaluated(false)
  }, [])

  const backspace = useCallback(() => {
    setError('')
    if (justEvaluated) {
      setJustEvaluated(false)
      setResult('')
      return
    }
    setTokens((prev) => prev.slice(0, -1))
  }, [justEvaluated])

  const equals = useCallback(() => {
    if (!tokens.length) return
    try {
      const value = evaluateTokens(tokens)
      const text = formatNumber(value)
      const num = toNumber(value)
      if (num !== null) setAns(num)
      setResult(text)
      setError('')
      setJustEvaluated(true)
      setHistory((h) => [{ expr: displayExpr, result: text, value: num }, ...h].slice(0, 15))
    } catch (e) {
      setError(e?.message === 'Math Error' ? 'Math Error' : 'Syntax Error')
      setResult('')
    }
  }, [tokens, evaluateTokens, displayExpr])

  const currentValue = () => {
    try {
      if (justEvaluated) return ans
      return toNumber(evaluateTokens(tokens))
    } catch {
      return null
    }
  }

  const memoryOp = (kind) => {
    if (kind === 'MC') return setMemory(0)
    if (kind === 'MR') return push(T.const(`(${memory})`, 'M'))
    const v = currentValue()
    if (v === null || !Number.isFinite(v)) return
    setMemory((m) => (kind === 'M+' ? m + v : m - v))
  }

  const negate = () => {
    if (justEvaluated) {
      setJustEvaluated(false)
      setResult('')
      setTokens([T.op('-', '−'), T.const('ans', 'Ans')])
      return
    }
    push(T.op('-', '−'))
  }

  const sci = second
    ? [
        [{ l: 'sin⁻¹', t: T.func('asin(', 'sin⁻¹(') }, { l: 'cos⁻¹', t: T.func('acos(', 'cos⁻¹(') }, { l: 'tan⁻¹', t: T.func('atan(', 'tan⁻¹(') },
         { l: 'sinh⁻¹', t: T.func('asinh(', 'sinh⁻¹(') }, { l: 'cosh⁻¹', t: T.func('acosh(', 'cosh⁻¹(') }, { l: 'tanh⁻¹', t: T.func('atanh(', 'tanh⁻¹(') }],
        [{ l: '√x', t: T.func('sqrt(', '√(') }, { l: '∛x', t: T.func('cbrt(', '∛(') }, { l: 'ʸ√x', t: T.func('root(', 'root('), title: 'root(x, n)' },
         { l: 'x⁻¹', t: T.postfix('^(-1)', '⁻¹') }, { l: 'eˣ', t: T.func('exp(', 'e^(') }, { l: '10ˣ', t: T.func('10^(', '10^(') }],
      ]
    : [
        [{ l: 'sin', t: T.func('sin(', 'sin(') }, { l: 'cos', t: T.func('cos(', 'cos(') }, { l: 'tan', t: T.func('tan(', 'tan(') },
         { l: 'sinh', t: T.func('sinh(', 'sinh(') }, { l: 'cosh', t: T.func('cosh(', 'cosh(') }, { l: 'tanh', t: T.func('tanh(', 'tanh(') }],
        [{ l: 'x²', t: T.postfix('^2', '²') }, { l: 'x³', t: T.postfix('^3', '³') }, { l: 'xʸ', t: T.op('^', '^') },
         { l: 'ln', t: T.func('log(', 'ln(') }, { l: 'log', t: T.func('log10(', 'log(') }, { l: 'logₓy', t: T.func('logb(', 'logb('), title: 'logb(value, base)' }],
      ]

  const sciRows = [
    ...sci,
    [{ l: 'π', t: T.const('pi', 'π') }, { l: 'e', t: T.const('e', 'e') }, { l: 'n!', t: T.func('fact(', 'fact(') },
     { l: '|x|', t: T.func('abs(', 'abs(') }, { l: 'nCr', t: T.func('nCr(', 'nCr('), title: 'nCr(n, r)' }, { l: 'nPr', t: T.func('nPr(', 'nPr('), title: 'nPr(n, r)' }],
    [{ l: '(', t: T.open() }, { l: ')', t: T.close() }, { l: ',', t: T.comma() },
     { l: 'mod', t: T.op(' mod ', ' mod ') }, { l: '%', t: T.postfix('/100', '%') }, { l: 'EXP', t: T.op('*10^', '×10^'), title: '×10ⁿ' }],
  ]

  const onKey = (e) => {
    const k = e.key
    if (/^[0-9]$/.test(k)) push(T.num(k))
    else if (k === '.') push(T.num('.'))
    else if (k === '+') push(T.op('+', '+'))
    else if (k === '-') push(T.op('-', '−'))
    else if (k === '*' || k === 'x') push(T.op('*', '×'))
    else if (k === '/') push(T.op('/', '÷'))
    else if (k === '^') push(T.op('^', '^'))
    else if (k === '(') push(T.open())
    else if (k === ')') push(T.close())
    else if (k === ',') push(T.comma())
    else if (k === '!') push(T.postfix('!', '!'))
    else if (k === '%') push(T.postfix('/100', '%'))
    else if (k === 'Enter' || k === '=') equals()
    else if (k === 'Backspace') backspace()
    else if (k === 'Escape' || k === 'Delete') clearAll()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    const onResize = () =>
      setPos((p) => {
        if (!p || !panelRef.current) return p
        const r = panelRef.current.getBoundingClientRect()
        return {
          x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - r.width)),
          y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - r.height)),
        }
      })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const startDrag = (e) => {
    if (e.button !== undefined && e.button !== 0) return
    const r = panelRef.current.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onDrag = (e) => {
    const d = dragRef.current
    if (!d) return
    setPos({
      x: Math.min(Math.max(0, e.clientX - d.dx), Math.max(0, window.innerWidth - d.w)),
      y: Math.min(Math.max(0, e.clientY - d.dy), Math.max(0, window.innerHeight - d.h)),
    })
  }
  const endDrag = () => {
    dragRef.current = null
  }

  if (!open) return null

  const btn = 'flex h-9 items-center justify-center rounded-md text-xs font-semibold transition-colors active:scale-95 select-none'
  const sciBtn = `${btn} bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700`
  const numBtn = `${btn} bg-white text-sm text-slate-900 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-700 dark:text-white dark:ring-slate-600 dark:hover:bg-slate-600`
  const opBtn = `${btn} bg-brand-50 text-sm text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25`

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKey}
      role="dialog"
      aria-label="Scientific calculator"
      className="fixed z-[60] w-[340px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 }}
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-move touch-none items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/60"
      >
        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
          <GripHorizontal className="h-4 w-4 text-slate-400" /> Scientific Calculator
        </span>
        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            title="History"
            className={`rounded p-1 ${showHistory ? 'text-brand-600' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <History className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} title="Close calculator" className="rounded p-1 text-slate-400 hover:text-rose-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-3 pt-3">
        <div className="rounded-xl bg-slate-900 px-3 py-2.5 text-right font-mono dark:bg-black">
          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400">
            <span className="flex gap-2">
              <span className="text-emerald-400">{angle}</span>
              {second && <span className="text-amber-400">2nd</span>}
              {memory !== 0 && <span className="text-sky-400">M</span>}
            </span>
            <span>Ans = {formatSafe(ans)}</span>
          </div>
          <div className="mt-1 min-h-[1.25rem] overflow-x-auto whitespace-nowrap text-sm text-slate-300">{displayExpr || '0'}</div>
          <div className={`min-h-[2rem] overflow-x-auto whitespace-nowrap text-2xl font-bold ${error ? 'text-rose-400' : 'text-white'}`}>
            {error || result || (preview ? <span className="text-slate-500">{preview}</span> : '')}
          </div>
        </div>
      </div>

      {showHistory ? (
        <div className="m-3 max-h-[300px] min-h-[200px] space-y-1 overflow-y-auto">
          {history.length === 0 && <p className="py-8 text-center text-xs text-slate-400">No calculations yet.</p>}
          {history.map((h, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                if (h.value !== null) {
                  setTokens([T.const(`(${h.value})`, h.result)])
                  setJustEvaluated(false)
                  setResult('')
                }
                setShowHistory(false)
              }}
              className="block w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-right font-mono hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <span className="block truncate text-[11px] text-slate-400">{h.expr}</span>
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">= {h.result}</span>
            </button>
          ))}
          {history.length > 0 && (
            <button type="button" onClick={() => setHistory([])} className="w-full pt-1 text-center text-[11px] font-semibold text-rose-600 hover:underline">
              Clear history
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2 p-3">
          <div className="grid grid-cols-6 gap-1">
            <button type="button" onClick={() => setSecond((s) => !s)} className={`${btn} ${second ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300'}`}>
              2nd
            </button>
            <button type="button" onClick={() => setAngle((a) => (a === 'DEG' ? 'RAD' : 'DEG'))} className={`${btn} bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300`}>
              {angle}
            </button>
            {['MC', 'MR', 'M+', 'M−'].map((m) => (
              <button key={m} type="button" onClick={() => memoryOp(m === 'M−' ? 'M-' : m)} className={sciBtn}>
                {m}
              </button>
            ))}
            {sciRows.flat().map((b) => (
              <button
                key={b.l}
                type="button"
                title={b.title}
                onClick={() => {
                  push(b.t)
                  if (second) setSecond(false)
                }}
                className={sciBtn}
              >
                {b.l}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-1">
            {['7', '8', '9'].map((n) => <button key={n} type="button" onClick={() => push(T.num(n))} className={numBtn}>{n}</button>)}
            <button type="button" onClick={backspace} title="Backspace" className={`${btn} bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200`}>
              <Delete className="h-4 w-4" />
            </button>
            <button type="button" onClick={clearAll} className={`${btn} bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-300`}>AC</button>
            {['4', '5', '6'].map((n) => <button key={n} type="button" onClick={() => push(T.num(n))} className={numBtn}>{n}</button>)}
            <button type="button" onClick={() => push(T.op('*', '×'))} className={opBtn}>×</button>
            <button type="button" onClick={() => push(T.op('/', '÷'))} className={opBtn}>÷</button>
            {['1', '2', '3'].map((n) => <button key={n} type="button" onClick={() => push(T.num(n))} className={numBtn}>{n}</button>)}
            <button type="button" onClick={() => push(T.op('+', '+'))} className={opBtn}>+</button>
            <button type="button" onClick={() => push(T.op('-', '−'))} className={opBtn}>−</button>
            <button type="button" onClick={() => push(T.num('0'))} className={numBtn}>0</button>
            <button type="button" onClick={() => push(T.num('.'))} className={numBtn}>.</button>
            <button type="button" onClick={negate} title="Negative" className={numBtn}>(−)</button>
            <button type="button" onClick={() => push(T.const('ans', 'Ans'))} className={opBtn}>Ans</button>
            <button type="button" onClick={equals} className={`${btn} bg-brand-600 text-base text-white hover:bg-brand-700`}>=</button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatSafe(v) {
  try {
    return formatNumber(v)
  } catch {
    return '0'
  }
}