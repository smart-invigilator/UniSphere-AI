import { describe, it, expect } from 'vitest'
import { splitBlocks, splitMath } from '../MathText'

describe('question statement rendering', () => {
  it('parses pipe tables with header and math cells', () => {
    const blocks = splitBlocks('Fill the table:\n| n | $n^2$ |\n|---|---|\n| 2 | 4 |\n| 3 | 9 |\nDone')
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'table', 'text'])
    expect(blocks[1].header).toEqual(['n', '$n^2$'])
    expect(blocks[1].rows).toEqual([['2', '4'], ['3', '9']])
  })

  it('leaves ordinary text and single pipe lines alone', () => {
    expect(splitBlocks('a | b\n| only one |').map((b) => b.kind)).toEqual(['text'])
  })

  it('keeps math segmentation unchanged', () => {
    expect(splitMath('x $a^2$ y').map((p) => p.kind)).toEqual(['text', 'inline', 'text'])
    expect(splitMath('$$\\int f$$')[0].kind).toBe('display')
  })
})