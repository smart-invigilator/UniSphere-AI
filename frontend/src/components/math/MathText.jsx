import { memo, useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const KATEX_OPTIONS = { throwOnError: false, strict: 'ignore', trust: false, output: 'html' }
const cache = new Map()

export function renderLatex(latex, displayMode = false) {
  const key = `${displayMode ? 'D' : 'I'}${latex}`
  if (cache.has(key)) return cache.get(key)
  let html
  try {
    html = katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode })
  } catch {
    html = ''
  }
  if (cache.size > 500) cache.clear()
  cache.set(key, html)
  return html
}

export function splitMath(text) {
  const parts = []
  const src = String(text ?? '')
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$((?:\\\$|[^$\n])+?)\$/g
  let last = 0
  let m
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', value: src.slice(last, m.index) })
    if (m[1] !== undefined || m[2] !== undefined) parts.push({ kind: 'display', value: m[1] ?? m[2] })
    else parts.push({ kind: 'inline', value: m[3] ?? m[4] })
    last = m.index + m[0].length
  }
  if (last < src.length) parts.push({ kind: 'text', value: src.slice(last) })
  return parts.map((p) => (p.kind === 'text' ? { ...p, value: p.value.replace(/\\\$/g, '$') } : p))
}

const TABLE_LINE = /^\s*\|.*\|\s*$/
const SEPARATOR_LINE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

function splitCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

export function splitBlocks(text) {
  const lines = String(text ?? '').split('\n')
  const blocks = []
  let buffer = []
  const flush = () => {
    if (buffer.length) blocks.push({ kind: 'text', value: buffer.join('\n') })
    buffer = []
  }
  for (let i = 0; i < lines.length; ) {
    if (TABLE_LINE.test(lines[i]) && i + 1 < lines.length && TABLE_LINE.test(lines[i + 1])) {
      let j = i
      while (j < lines.length && TABLE_LINE.test(lines[j])) j += 1
      const rows = lines.slice(i, j)
      const hasHeader = rows.length > 1 && SEPARATOR_LINE.test(rows[1])
      const body = rows.filter((r, idx) => !(hasHeader && idx === 1)).map(splitCells)
      flush()
      blocks.push({ kind: 'table', header: hasHeader ? body[0] : null, rows: hasHeader ? body.slice(1) : body })
      i = j
    } else {
      buffer.push(lines[i])
      i += 1
    }
  }
  flush()
  return blocks
}

function InlineMath({ text }) {
  const parts = useMemo(() => splitMath(text), [text])
  return parts.map((p, i) =>
    p.kind === 'text' ? (
      <span key={i}>{p.value}</span>
    ) : (
      <span
        key={i}
        className={p.kind === 'display' ? 'my-2 block overflow-x-auto' : 'inline-block max-w-full overflow-x-auto align-middle'}
        dangerouslySetInnerHTML={{ __html: renderLatex(p.value, p.kind === 'display') }}
      />
    ),
  )
}

function MathText({ text, className = '', as: As = 'div', block = true }) {
  const blocks = useMemo(() => (block ? splitBlocks(text) : [{ kind: 'text', value: String(text ?? '') }]), [text, block])
  if (blocks.every((b) => b.kind === 'text')) {
    return (
      <As className={`${block ? 'whitespace-pre-wrap break-words' : ''} ${className}`}>
        <InlineMath text={blocks.map((b) => b.value).join('\n')} />
      </As>
    )
  }
  return (
    <As className={`break-words ${className}`}>
      {blocks.map((b, i) =>
        b.kind === 'text' ? (
          <div key={i} className="whitespace-pre-wrap"><InlineMath text={b.value} /></div>
        ) : (
          <div key={i} className="my-2 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              {b.header && (
                <thead>
                  <tr>
                    {b.header.map((c, ci) => (
                      <th key={ci} className="border border-slate-300 bg-slate-100 px-2 py-1 text-left font-semibold dark:border-slate-600 dark:bg-slate-800"><InlineMath text={c} /></th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci} className="border border-slate-300 px-2 py-1 align-top dark:border-slate-600"><InlineMath text={c} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </As>
  )
}

export function LatexBlock({ latex, display = true, className = '' }) {
  const html = useMemo(() => renderLatex(String(latex ?? ''), display), [latex, display])
  return <div className={`overflow-x-auto ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}

export default memo(MathText)