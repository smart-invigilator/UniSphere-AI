import { describe, it, expect } from 'vitest'
import { blankQuestion, questionToPayload, questionFromApi, parseResponse, serializeResponse, isAnswered, usesUnifiedEditor } from '../questionTypes'

describe('short/long answer configuration', () => {
  it('defaults to all tools and round-trips the teacher selection', () => {
    for (const type of ['short', 'essay']) {
      const q = blankQuestion(type)
      expect(q.settings.allowed_components).toEqual(['math', 'code', 'diagram', 'table'])
      q.text = 'Explain'
      q.settings.allowed_components = ['table', 'math']
      const payload = questionToPayload(q)
      expect(payload.settings.allowed_components).toEqual(['math', 'table'])
      const back = questionFromApi({ id: 1, order: 0, ...payload })
      expect(back.settings.allowed_components).toEqual(['math', 'table'])
    }
  })

  it('legacy questions without a setting get every tool', () => {
    expect(questionFromApi({ id: 2, order: 0, type: 'short', text: 'x', marks: 2, settings: {} }).settings.allowed_components).toEqual(['math', 'code', 'diagram', 'table'])
  })

  it('serializes documents only for unified-editor types', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    const raw = serializeResponse('essay', doc)
    expect(JSON.parse(raw).format).toBe('unisphere.answer')
    expect(parseResponse('essay', raw)).toEqual(doc)
    expect(isAnswered('essay', doc)).toBe(true)
    expect(serializeResponse('essay', { type: 'doc', content: [{ type: 'paragraph' }] })).toBe('')
    expect(serializeResponse('mcq', 'B')).toBe('B')
    expect(parseResponse('short', 'old plain text').content[0].content[0].text).toBe('old plain text')
    expect(usesUnifiedEditor('mcq')).toBe(false)
  })
})

import { marksError, gradeMarksError } from '../questionTypes'
import { blankQuestion as blank, questionToPayload as toPayload, questionFromApi as fromApi, validateQuestion as validate } from '../questionTypes'

describe('marks validation', () => {
  it('question marks must be whole numbers from 1 to 1000', () => {
    expect(marksError('')).toMatch(/Enter/)
    expect(marksError('-1')).toMatch(/at least 1/)
    expect(marksError('0')).toMatch(/at least 1/)
    expect(marksError('2.5')).toMatch(/whole number/)
    expect(marksError('1001')).toMatch(/more than 1000/)
    expect(marksError('abc')).toMatch(/number/)
    expect(marksError('1')).toBe(null)
    expect(marksError(1000)).toBe(null)
  })

  it('awarded marks must be between 0 and the question total, max 2 decimals', () => {
    expect(gradeMarksError('', 10)).toMatch(/Enter/)
    expect(gradeMarksError('-0.5', 10)).toMatch(/negative/)
    expect(gradeMarksError('10.01', 10)).toMatch(/more than 10/)
    expect(gradeMarksError('15', 10)).toMatch(/more than 10/)
    expect(gradeMarksError('2.555', 10)).toMatch(/2 decimal/)
    expect(gradeMarksError('0', 10)).toBe(null)
    expect(gradeMarksError('9.75', 10)).toBe(null)
    expect(gradeMarksError('10', 10)).toBe(null)
  })

  it('invalid question marks block saving and are never silently changed', () => {
    const q = blank('mcq')
    Object.assign(q, { text: 'Pick', options: ['a', 'b'], correctIndex: 0, marks: '2.5' })
    expect(validate(q)).toMatch(/whole number/)
    q.marks = '7'
    expect(validate(q)).toBe(null)
    expect(toPayload(q).marks).toBe(7)
  })
})

describe('question rich content', () => {
  it('round-trips tables, diagrams and equations through the API payload', () => {
    const q = blank('essay')
    q.text = 'Use the table'
    q.richContent = {
      type: 'doc',
      content: [
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] }] },
        { type: 'mathBlock', attrs: { latex: '\\int_0^1 x\\,dx' } },
        { type: 'diagram', attrs: { scene: { elements: [{ id: 'r', type: 'rectangle' }], appState: {} } } },
      ],
    }
    const p = toPayload(q)
    expect(JSON.parse(p.settings.rich_content).doc.content.map((n) => n.type)).toEqual(['table', 'mathBlock', 'diagram'])
    const back = fromApi({ id: 9, order: 0, ...p })
    expect(back.richContent.content[1].attrs.latex).toBe('\\int_0^1 x\\,dx')
    expect(back.settings.rich_content).toBeUndefined()
  })

  it('empty content is not sent', () => {
    const q = blank('mcq')
    Object.assign(q, { text: 'x', options: ['a', 'b'] })
    q.richContent = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(toPayload(q).settings.rich_content).toBeUndefined()
  })
})