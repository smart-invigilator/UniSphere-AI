
let cached = null
let pending = null

export const getKatex = () => cached

export function loadKatex() {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([mod]) => { cached = mod.default; return cached })
      .catch((err) => { pending = null; throw err })
  }
  return pending
}cl
