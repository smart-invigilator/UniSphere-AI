import katex from 'katex'
import 'katex/dist/katex.min.css'

const cache = new Map()

export function renderMathSafe(latex, displayMode) {
  const key = `${displayMode ? 'D' : 'I'}${latex}`
  if (cache.has(key)) return cache.get(key)
  let result
  try {
    result = {
      html: katex.renderToString(latex, {
        displayMode,
        throwOnError: true,
        strict: 'ignore',
        trust: false,
        maxSize: 50,
        maxExpand: 1000,
        output: 'html',
      }),
      error: null,
    }
  } catch (e) {
    result = { html: '', error: (e?.message || 'Invalid equation').replace(/^KaTeX parse error:\s*/, '') }
  }
  if (cache.size > 800) cache.clear()
  cache.set(key, result)
  return result
}