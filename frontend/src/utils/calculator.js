
export class CalcError extends Error {}

const MATH_ERROR = 'Math ERROR'
const SYNTAX_ERROR = 'Syntax ERROR'

const mathError = () => new CalcError(MATH_ERROR)
const syntaxError = () => new CalcError(SYNTAX_ERROR)

export const FUNCTION_NAMES = [
  'sinh⁻¹', 'cosh⁻¹', 'tanh⁻¹',
  'sin⁻¹', 'cos⁻¹', 'tan⁻¹',
  'sinh', 'cosh', 'tanh',
  'sin', 'cos', 'tan',
  'ln', 'log', 'abs', '√', '∛',
]
export const WORD_OPERATORS = ['nCr', 'nPr', 'mod', 'ʸ√']

const NUMBER_RE = /^(\d+\.?\d*|\.\d+)(E[+\-−]?\d+)?/


function tokenize(src, ans) {
  const tokens = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }

    const rest = src.slice(i)

    const num = NUMBER_RE.exec(rest)
    if (num) {
      tokens.push({ t: 'num', v: parseFloat(num[0].replace('−', '-')) })
      i += num[0].length
      continue
    }

    if (rest.startsWith('Ans')) { tokens.push({ t: 'num', v: ans }); i += 3; continue }

    const fn = FUNCTION_NAMES.find((name) => rest.startsWith(name))
    if (fn) { tokens.push({ t: 'func', v: fn }); i += fn.length; continue }

    const word = WORD_OPERATORS.find((name) => rest.startsWith(name))
    if (word) { tokens.push({ t: 'op', v: word }); i += word.length; continue }

    if (ch === 'π') { tokens.push({ t: 'num', v: Math.PI }); i++; continue }
    if (ch === 'e') { tokens.push({ t: 'num', v: Math.E }); i++; continue }

    switch (ch) {
      case '+': tokens.push({ t: 'op', v: '+' }); break
      case '-': case '−': tokens.push({ t: 'op', v: '-' }); break
      case '*': case '×': tokens.push({ t: 'op', v: '*' }); break
      case '/': case '÷': tokens.push({ t: 'op', v: '/' }); break
      case '^': tokens.push({ t: 'op', v: '^' }); break
      case '!': case '%': case '²': case '³': tokens.push({ t: 'post', v: ch }); break
      case '(': tokens.push({ t: 'lp' }); break
      case ')': tokens.push({ t: 'rp' }); break
      default: throw syntaxError()
    }
    i++
  }
  return tokens
}


const DEG = Math.PI / 180
const tiny = (v) => (Math.abs(v) < 1e-15 ? 0 : v)

function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 170) throw mathError()
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

function nCr(n, r) {
  if (![n, r].every(Number.isInteger) || n < 0 || r < 0 || r > n) throw mathError()
  const k = Math.min(r, n - r)
  let res = 1
  for (let i = 1; i <= k; i++) res = (res * (n - k + i)) / i
  return Math.round(res)
}

function nPr(n, r) {
  if (![n, r].every(Number.isInteger) || n < 0 || r < 0 || r > n) throw mathError()
  let res = 1
  for (let i = 0; i < r; i++) res *= n - i
  return res
}

function sinDeg(d) {
  const r = ((d % 360) + 360) % 360
  if (r % 180 === 0) return 0
  if (r === 90) return 1
  if (r === 270) return -1
  return Math.sin(r * DEG)
}

function cosDeg(d) {
  const r = ((d % 360) + 360) % 360
  if (r === 0) return 1
  if (r === 180) return -1
  if (r === 90 || r === 270) return 0
  return Math.cos(r * DEG)
}

function tanDeg(d) {
  const r = ((d % 180) + 180) % 180
  if (r === 0) return 0
  if (r === 90) throw mathError()
  return Math.tan(r * DEG)
}

function applyFunction(name, x, angle) {
  const deg = angle === 'deg'
  const fromRad = (a) => (deg ? a / DEG : a)
  switch (name) {
    case 'sin': return deg ? sinDeg(x) : tiny(Math.sin(x))
    case 'cos': return deg ? cosDeg(x) : tiny(Math.cos(x))
    case 'tan': {
      if (deg) return tanDeg(x)
      if (Math.abs(Math.cos(x)) < 1e-15) throw mathError()
      return tiny(Math.tan(x))
    }
    case 'sin⁻¹': if (Math.abs(x) > 1) throw mathError(); return fromRad(Math.asin(x))
    case 'cos⁻¹': if (Math.abs(x) > 1) throw mathError(); return fromRad(Math.acos(x))
    case 'tan⁻¹': return fromRad(Math.atan(x))
    case 'sinh': return Math.sinh(x)
    case 'cosh': return Math.cosh(x)
    case 'tanh': return Math.tanh(x)
    case 'sinh⁻¹': return Math.asinh(x)
    case 'cosh⁻¹': if (x < 1) throw mathError(); return Math.acosh(x)
    case 'tanh⁻¹': if (Math.abs(x) >= 1) throw mathError(); return Math.atanh(x)
    case 'ln': if (x <= 0) throw mathError(); return Math.log(x)
    case 'log': if (x <= 0) throw mathError(); return Math.log10(x)
    case 'abs': return Math.abs(x)
    case '√': if (x < 0) throw mathError(); return Math.sqrt(x)
    case '∛': return Math.cbrt(x)
    default: throw syntaxError()
  }
}

function applyBinary(op, a, b) {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/': if (b === 0) throw mathError(); return a / b
    case 'mod': if (b === 0) throw mathError(); return ((a % b) + b) % b
    case 'nCr': return nCr(a, b)
    case 'nPr': return nPr(a, b)
    case 'ʸ√': {
      // "a ʸ√ b"  →  the a-th root of b
      if (a === 0) throw mathError()
      if (b < 0) {
        if (Number.isInteger(a) && Math.abs(a % 2) === 1) return -Math.pow(-b, 1 / a)
        throw mathError()
      }
      return Math.pow(b, 1 / a)
    }
    default: throw syntaxError()
  }
}


const MULTIPLICATIVE = new Set(['*', '/', 'mod', 'nCr', 'nPr', 'ʸ√'])

export function evaluate(source, { angle = 'deg', ans = 0 } = {}) {
  let src = String(source ?? '').trim()
  if (!src) return null

  const open = (src.match(/\(/g) || []).length
  const close = (src.match(/\)/g) || []).length
  if (close > open) throw syntaxError()
  src += ')'.repeat(open - close)

  const tokens = tokenize(src, ans)
  let pos = 0
  const peek = () => tokens[pos]
  const take = () => tokens[pos++]

  const startsOperand = (tok) =>
    tok && (tok.t === 'num' || tok.t === 'func' || tok.t === 'lp')

  function parseExpression() {
    let value = parseTerm()
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = take().v
      value = applyBinary(op, value, parseTerm())
    }
    return value
  }

  function parseTerm() {
    let value = parseUnary()
    for (;;) {
      const tok = peek()
      if (!tok) break
      if (tok.t === 'op' && MULTIPLICATIVE.has(tok.v)) {
        take()
        value = applyBinary(tok.v, value, parseUnary())
      } else if (startsOperand(tok)) {
        value *= parseUnary() 
      } else {
        break
      }
    }
    return value
  }

  function parseUnary() {
    const tok = peek()
    if (tok?.t === 'op' && tok.v === '-') { take(); return -parseUnary() }
    if (tok?.t === 'op' && tok.v === '+') { take(); return parseUnary() }
    return parsePower()
  }

  function parsePower() {
    const base = parsePostfix()
    if (peek()?.t === 'op' && peek().v === '^') {
      take()
      const exponent = parseUnary() 
      const result = Math.pow(base, exponent)
      if (Number.isNaN(result)) throw mathError()
      return result
    }
    return base
  }

  function parsePostfix() {
    let value = parsePrimary()
    while (peek()?.t === 'post') {
      const op = take().v
      if (op === '!') value = factorial(value)
      else if (op === '%') value /= 100
      else if (op === '²') value *= value
      else if (op === '³') value = value * value * value
    }
    return value
  }

  function parsePrimary() {
    const tok = take()
    if (!tok) throw syntaxError()
    if (tok.t === 'num') return tok.v
    if (tok.t === 'lp') {
      const value = parseExpression()
      if (take()?.t !== 'rp') throw syntaxError()
      return value
    }
    if (tok.t === 'func') {
      let arg
      if (peek()?.t === 'lp') {
        take()
        arg = parseExpression()
        if (take()?.t !== 'rp') throw syntaxError()
      } else {
        arg = parseUnary() 
      }
      return applyFunction(tok.v, arg, angle)
    }
    throw syntaxError()
  }

  const result = parseExpression()
  if (pos < tokens.length) throw syntaxError()
  if (!Number.isFinite(result)) throw mathError()
  return result
}


export function formatNumber(value) {
  if (value === 0 || Object.is(value, -0)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e15 || abs < 1e-6) {
    const [mantissa, exponent] = value.toExponential(11).split('e')
    return `${mantissa.replace(/\.?0+$/, '')}E${parseInt(exponent, 10)}`
  }
  return String(parseFloat(value.toPrecision(12)))
}

export function safeEvaluate(source, options) {
  try {
    return { value: evaluate(source, options), error: null }
  } catch (err) {
    return { value: null, error: err instanceof CalcError ? err.message : MATH_ERROR }
  }
}