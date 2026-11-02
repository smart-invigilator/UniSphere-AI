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