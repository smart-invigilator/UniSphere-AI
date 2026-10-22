
export function splitMath(text) {
  const src = String(text ?? '')
  const out = []
  let buf = ''
  const flush = () => { if (buf) { out.push({ type: 'text', value: buf }); buf = '' } }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && src[i + 1] === '$') { buf += '$'; i += 2; continue }
    if (ch === '$' && src[i + 1] === '$') {
      const end = src.indexOf('$$', i + 2)
      if (end > i + 2) {
        flush(); out.push({ type: 'display', value: src.slice(i + 2, end).trim() }); i = end + 2; continue
      }
    } else if (ch === '$' && src[i + 1] && !/\s/.test(src[i + 1])) {
      let j = i + 1
      let found = -1
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '$') {
          if (!/\s/.test(src[j - 1]) && !/\d/.test(src[j + 1] ?? '')) found = j
          break
        }
        j++
      }
      if (found > i + 1) {
        flush(); out.push({ type: 'inline', value: src.slice(i + 1, found) }); i = found + 1; continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return out
}
export function plainToTex(expr) {
  let s = String(expr ?? '').trim()
  if (!s) return ''
  s = s.replace(/\*\*/g, '^').replace(/√\s*\(/g, 'sqrt(').replace(/√\s*([A-Za-z0-9.]+)/g, 'sqrt($1)')
  s = s.replace(/π/g, 'pi').replace(/×|·|⋅/g, '*').replace(/−/g, '-').replace(/÷/g, '/')
  s = s.replace(/²/g, '^2').replace(/³/g, '^3')
  const group = (str, open) => {           // returns index of the matching ")" for the "(" at `open`s
    let depth = 0
    for (let k = open; k < str.length; k++) {
      if (str[k] === '(') depth++
      else if (str[k] === ')' && --depth === 0) return k
    }
    return -1
  }
  const convert = (str) => {
    let res = ''
    let k = 0
    while (k < str.length) {
      const rest = str.slice(k)
      const fn = /^(sqrt|cbrt|abs)\(/.exec(rest)
      if (fn) {
        const open = k + fn[0].length - 1
        const close = group(str, open)
        if (close > 0) {
          const inner = convert(str.slice(open + 1, close))
          res += fn[1] === 'sqrt' ? `\\sqrt{${inner}}` : fn[1] === 'cbrt' ? `\\sqrt[3]{${inner}}` : `\\left|${inner}\\right|`
          k = close + 1; continue
        }
      }
      const trig = /^(sin|cos|tan|sec|csc|cot|asin|acos|atan|sinh|cosh|tanh|exp|ln|log)\b/.exec(rest)
      if (trig) { res += `\\${trig[1].replace(/^a(sin|cos|tan)$/, 'arc$1')}`; k += trig[0].length; continue }
      if (/^pi\b/.test(rest)) { res += '\\pi'; k += 2; continue }
      if (str[k] === '*') { res += '\\cdot '; k++; continue }
      if (str[k] === '^') {
        const after = str.slice(k + 1)
        if (after[0] === '(') {
          const close = group(str, k + 1)
          if (close > 0) { res += `^{${convert(str.slice(k + 2, close))}}`; k = close + 1; continue }
        }
        const m = /^-?[A-Za-z0-9.]+/.exec(after)
        if (m) { res += `^{${m[0]}}`; k += 1 + m[0].length; continue }
      }
      res += str[k]
      k++
    }
    return res
  }
  return convert(s)
}
