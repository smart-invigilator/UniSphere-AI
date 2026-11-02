import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { createAnswerExtensions } from '../extensions'
import {
  parseAnswer, serializeAnswer, textToDoc, isDocEmpty, countWords, componentsUsed, sanitizeScene,
  FORMAT, SCHEMA_VERSION, usesUnifiedEditor,
} from '../schema'

export const MIXED = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Step 1 — “Unicode” ∀x ', marks: [{ type: 'bold' }] }, { type: 'mathInline', attrs: { latex: '\\frac{a}{b}' } }] },
    { type: 'mathBlock', attrs: { latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Now the diagram' }] },
    { type: 'diagram', attrs: { scene: { elements: [{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 50, height: 20 }, { id: 'a', type: 'arrow', x: 50, y: 10, points: [[0, 0], [40, 0]], startBinding: { elementId: 'r' } }], appState: { viewBackgroundColor: '#ffffff' } } } },
    { type: 'table', content: [
      { type: 'tableRow', content: [
        { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'n' }] }] },
        { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cost' }] }] },
      ] },
      { type: 'tableRow', content: [
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'mathInline', attrs: { latex: 'n^2' } }] }] },
      ] },
    ] },
    { type: 'codeBlock', attrs: { language: 'python', code: 'def f(x):\n\tif x:\n        return "a\\\\b"  \n\n' } },
  ],
}

let editors = []
const make = (opts = {}, content = MIXED) => {
  const e = new Editor({ element: document.createElement('div'), extensions: createAnswerExtensions(opts), content })
  editors.push(e)
  return e
}
afterEach(() => {
  editors.forEach((e) => e.destroy())
  editors = []
})

describe('answer document model', () => {
  it('keeps every component type, in order, with exact content', () => {
    const json = make().getJSON()
    expect(json.content.map((n) => n.type)).toEqual(['paragraph', 'mathBlock', 'paragraph', 'diagram', 'table', 'codeBlock'])
    expect(json.content[0].content[0].text).toBe('Step 1 — “Unicode” ∀x ')
    expect(json.content[0].content[1].attrs.latex).toBe('\\frac{a}{b}')
    expect(json.content[1].attrs.latex).toBe('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}')
    expect(json.content[3].attrs.scene.elements[1].startBinding).toEqual({ elementId: 'r' })
    expect(json.content[4].content[1].content[1].content[0].content[0].attrs.latex).toBe('n^2')
    expect(json.content[5].attrs.code).toBe('def f(x):\n\tif x:\n        return "a\\\\b"  \n\n')
  })

  it('round-trips through serialize/parse and a fresh editor without changes', () => {
    const first = make().getJSON()
    const raw = serializeAnswer(first)
    const env = JSON.parse(raw)
    expect(env.format).toBe(FORMAT)
    expect(env.schema_version).toBe(SCHEMA_VERSION)
    const second = make({}, parseAnswer(raw).doc).getJSON()
    expect(second).toEqual(first)
  })

  it('assigns stable, unique block ids', async () => {
    const e = make()
    await new Promise((r) => setTimeout(r, 0))
    const ids = e.getJSON().content.map((n) => n.attrs?.id)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    e.commands.insertContentAt(e.state.doc.content.size, { type: 'paragraph', attrs: { id: ids[0] }, content: [{ type: 'text', text: 'dup' }] })
    const after = e.getJSON().content.map((n) => n.attrs?.id)
    expect(new Set(after).size).toBe(after.length)
    expect(after.slice(0, ids.length)).toEqual(ids)
  })

  it('blocks insertion of components the question does not allow', () => {
    const e = make({ allowed: ['math'] }, { type: 'doc', content: [{ type: 'paragraph' }] })
    e.commands.insertContent({ type: 'codeBlock', attrs: { code: 'x' } })
    e.commands.insertContent({ type: 'diagram' })
    e.commands.insertTable({ rows: 2, cols: 2 })
    expect(componentsUsed(e.getJSON()).size).toBe(0)
    e.commands.insertContent({ type: 'mathBlock', attrs: { latex: 'x^2' } })
    expect([...componentsUsed(e.getJSON())]).toEqual(['math'])
  })

  it('does not allow code or diagrams inside table cells', () => {
    const e = make()
    const cellPos = []
    e.state.doc.descendants((n, pos) => { if (n.type.name === 'tableCell') cellPos.push(pos) })
    e.commands.insertContentAt(cellPos[0] + 2, { type: 'codeBlock', attrs: { code: 'x' } })
    let codeInCell = false
    e.state.doc.descendants((n, pos, parent) => { if (n.type.name === 'codeBlock' && parent.type.name !== 'doc') codeInCell = true })
    expect(codeInCell).toBe(false)
    expect(() => e.state.doc.check()).not.toThrow()
  })

  it('converts legacy text answers, keeping $math$', () => {
    const { doc, legacyText } = parseAnswer('Line one $x^2$ end\n\nLast')
    expect(legacyText).toBe('Line one $x^2$ end\n\nLast')
    expect(doc.content[0].content.map((n) => n.type)).toEqual(['text', 'mathInline', 'text'])
    expect(doc.content.length).toBe(3)
    expect(textToDoc('a $b$', ['code']).content[0].content).toEqual([{ type: 'text', text: 'a $b$' }])
  })

  it('reports newer schema versions instead of corrupting them', () => {
    const raw = JSON.stringify({ format: FORMAT, schema_version: 99, doc: { type: 'doc', content: [] } })
    const res = parseAnswer(raw)
    expect(res.error).toMatch(/newer version/)
    expect(res.legacyText).toBe(raw)
  })

  it('detects empty documents and counts words', () => {
    expect(isDocEmpty({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true)
    expect(isDocEmpty({ type: 'doc', content: [{ type: 'mathBlock', attrs: { latex: 'x' } }] })).toBe(false)
    expect(countWords(MIXED)).toBe(11)
  })

  it('sanitizes diagram scenes', () => {
    const s = sanitizeScene({ elements: [{ id: 'i', type: 'image', fileId: 'f' }, { id: 'l', type: 'line', link: 'javascript:alert(1)', customData: { x: 1 } }, { id: 'd', type: 'rectangle', isDeleted: true }], appState: { viewBackgroundColor: 'url(x)', zoom: 2 } })
    expect(s.elements).toEqual([{ id: 'l', type: 'line', link: null }])
    expect(s.appState).toEqual({})
  })

  it('identifies unified-editor question types centrally', () => {
    expect(['short', 'essay'].every(usesUnifiedEditor)).toBe(true)
    expect(['mcq', 'tf', 'multi', 'fill_blank', 'matching', 'ordering', 'math', 'numeric'].some(usesUnifiedEditor)).toBe(false)
  })

  it('blocks keyboard and text input while a component dialog is open', () => {
    const e = make({}, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }] })
    const view = e.view
    const typeX = () => view.someProp('handleTextInput', (f) => f(view, 1, 1, 'x'))
    const keyDown = () => view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'r' })))
    expect(!!typeX()).toBe(false)
    e.storage.modalLock.count = 1
    expect(typeX()).toBe(true)
    expect(keyDown()).toBe(true)
    e.commands.insertContentAt(1, 'programmatic ')
    expect(e.getText()).toContain('programmatic abc')
    e.storage.modalLock.count = 0
    expect(!!keyDown()).toBe(false)
  })

  it('typing while a diagram/code/equation is selected never replaces it', async () => {
    const { NodeSelection } = await import('@tiptap/pm/state')
    const e = make()
    let pos = -1
    e.state.doc.forEach((n, offset) => { if (n.type.name === 'diagram') pos = offset })
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, pos)))
    const handled = e.view.someProp('handleTextInput', (f) => f(e.view, pos, pos + 1, '0'))
    expect(handled).toBe(true)
    const types = e.getJSON().content.map((n) => n.type)
    expect(types.slice(0, 6)).toEqual(['paragraph', 'mathBlock', 'paragraph', 'diagram', 'paragraph', 'table'])
    expect(e.getJSON().content[4].content[0].text).toBe('0')
  })
})