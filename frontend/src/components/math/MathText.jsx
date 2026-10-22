import { memo, useEffect, useMemo, useState } from 'react'
import { splitMath } from '../../utils/mathSplit'
import { getKatex, loadKatex } from '../../utils/katexLoader'

function renderTex(katex, tex, display) {
  try {
    return katex.renderToString(tex, {
      displayMode: display, throwOnError: false, trust: false, strict: 'ignore',
      maxExpand: 500, maxSize: 20, output: 'htmlAndMathml',
    })
  } catch {
    return null
  }
}

function useKatex(needed) {
  const [katex, setKatex] = useState(getKatex())
  useEffect(() => {
    if (!needed || katex) return undefined
    let alive = true
    loadKatex().then((k) => { if (alive) setKatex(k) }).catch(() => {})
    return () => { alive = false }
  }, [needed, katex])
  return katex
}

function MathText({ text, className = '', as: Tag = 'span' }) {
  const pieces = useMemo(() => splitMath(text), [text])
  const needsMath = pieces.some((p) => p.type !== 'text')
  const katex = useKatex(needsMath)
  const parts = useMemo(
    () => pieces.map((p) => (p.type === 'text' || !katex ? p : { ...p, html: renderTex(katex, p.value, p.type === 'display') })),
    [pieces, katex],
  )
  return (
    <Tag className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((p, i) =>
        p.html != null
          ? <span key={i} dangerouslySetInnerHTML={{ __html: p.html }} />
          : <span key={i}>{p.type === 'text' ? p.value : p.type === 'display' ? `$$${p.value}$$` : `$${p.value}$`}</span>,
      )}
    </Tag>
  )
}

export default memo(MathText)

export const Tex = memo(function Tex({ tex, display = false, className = '' }) {
  const katex = useKatex(!!tex)
  const html = useMemo(() => (tex && katex ? renderTex(katex, tex, display) : null), [tex, display, katex])
  if (!tex) return null
  if (!html) return <span className={className}>{tex}</span>
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
})
