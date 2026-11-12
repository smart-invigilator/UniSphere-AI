import { describe, it, expect } from 'vitest'
import { renderMathSafe } from '../mathRender'

describe('renderMathSafe', () => {
  it('shows empty matrix slots as boxes instead of a placeholder error', () => {
    const r = renderMathSafe('\\begin{bmatrix}1&\\placeholder{}\\\\\\placeholder{}&4\\end{bmatrix}', false)
    expect(r.error).toBeNull()
    expect(r.incomplete).toBe(true)
  })
  it('keeps filled placeholder content', () => {
    const r = renderMathSafe('\\placeholder[a]{x}+1', false)
    expect(r.error).toBeNull()
    expect(r.incomplete).toBe(false)
  })
})
