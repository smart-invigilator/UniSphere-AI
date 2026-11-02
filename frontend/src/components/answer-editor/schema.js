import { splitMath } from '../math/MathText'

export const FORMAT = 'unisphere.answer'
export const SCHEMA_VERSION = 1
export const COMPONENTS = ['math', 'code', 'diagram', 'table']
export const COMPONENT_LABELS = { math: 'Equations', code: 'Code blocks', diagram: 'Diagrams', table: 'Tables' }
export const UNIFIED_EDITOR_TYPES = new Set(['short', 'essay'])
export const usesUnifiedEditor = (type) => UNIFIED_EDITOR_TYPES.has(type)

export const COMPONENT_OF = {
  mathInline: 'math',
  mathBlock: 'math',
  codeBlock: 'code',
  diagram: 'diagram',
  table: 'table',
  tableRow: 'table',
  tableCell: 'table',
  tableHeader: 'table',
}

export const CODE_LANGUAGES = [
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'java', label: 'Java' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'plaintext', label: 'Plain text' },
]

export const LIMITS = {
  latex: 5000,
  code: 50000,
  diagramElements: 3000,
  tableRows: 60,
  tableCols: 20,
  documentBytes: 2400000,
}

export const DIAGRAM_ELEMENT_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'freedraw', 'text', 'frame'])

export function normalizeAllowed(allowed) {
  if (!Array.isArray(allowed)) return [...COMPONENTS]
  return COMPONENTS.filter((c) => allowed.includes(c))
}

export function emptyDoc() {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

export function createEnvelope(doc) {
  return { format: FORMAT, schema_version: SCHEMA_VERSION, doc: doc || emptyDoc() }
}

export function migrateEnvelope(envelope) {
  const version = envelope?.schema_version
  if (!Number.isInteger(version) || version < 1) throw new Error('Unsupported answer format')
  if (version > SCHEMA_VERSION) throw new Error('This answer was saved by a newer version of the editor')
  return envelope
}

function paragraphFromLine(line, allowMath) {
  if (!line) return { type: 'paragraph' }
  const content = []
  for (const part of allowMath ? splitMath(line) : [{ kind: 'text', value: line }]) {
    if (part.kind === 'text') {
      if (part.value) content.push({ type: 'text', text: part.value })
    } else {
      content.push({ type: 'mathInline', attrs: { latex: part.value } })
    }
  }
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

export function textToDoc(text, allowed = COMPONENTS) {
  const allowMath = normalizeAllowed(allowed).includes('math')
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const content = lines.map((line) => paragraphFromLine(line, allowMath))
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

export function isDocumentString(raw) {
  return typeof raw === 'string' && raw.trimStart().startsWith('{') && raw.slice(0, 200).includes(`"${FORMAT}"`)
}

export function parseAnswer(raw, allowed = COMPONENTS) {
  if (raw && typeof raw === 'object' && raw.type === 'doc') return { doc: raw, legacyText: null, error: null }
  if (raw === undefined || raw === null || raw === '') return { doc: emptyDoc(), legacyText: null, error: null }
  if (isDocumentString(raw)) {
    try {
      const envelope = migrateEnvelope(JSON.parse(raw))
      if (!envelope.doc || envelope.doc.type !== 'doc') throw new Error('Answer document is missing its content')
      return { doc: envelope.doc, legacyText: null, error: null }
    } catch (e) {
      return { doc: textToDoc(raw, []), legacyText: raw, error: e.message || 'Could not read this answer' }
    }
  }
  return { doc: textToDoc(raw, allowed), legacyText: String(raw), error: null }
}

export function serializeAnswer(doc) {
  return JSON.stringify(createEnvelope(doc))
}

export function walkDoc(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  if (Array.isArray(node.content)) node.content.forEach((child) => walkDoc(child, visit))
}

export function isDocEmpty(doc) {
  let empty = true
  walkDoc(doc, (n) => {
    if (!empty) return
    if (n.type === 'text' && n.text.trim()) empty = false
    if ((n.type === 'mathInline' || n.type === 'mathBlock') && (n.attrs?.latex || '').trim()) empty = false
    if (n.type === 'codeBlock' && (n.attrs?.code || '').trim()) empty = false
    if (n.type === 'diagram' && (n.attrs?.scene?.elements || []).length) empty = false
    if (n.type === 'table' || n.type === 'horizontalRule') empty = false
  })
  return empty
}

export function docPlainText(doc) {
  const parts = []
  walkDoc(doc, (n) => {
    if (n.type === 'text') parts.push(n.text)
    if (n.type === 'paragraph' || n.type === 'heading') parts.push(' ')
  })
  return parts.join('')
}

export function countWords(doc) {
  return docPlainText(doc).trim().split(/\s+/).filter(Boolean).length
}

export function componentsUsed(doc) {
  const used = new Set()
  walkDoc(doc, (n) => {
    if (COMPONENT_OF[n.type]) used.add(COMPONENT_OF[n.type])
  })
  return used
}

export function sanitizeScene(scene) {
  const elements = (scene?.elements || [])
    .filter((el) => el && !el.isDeleted && DIAGRAM_ELEMENT_TYPES.has(el.type))
    .slice(0, LIMITS.diagramElements)
    .map((el) => {
      const { customData, fileId, ...rest } = el
      if (rest.link && !/^https?:\/\//i.test(rest.link)) rest.link = null
      return rest
    })
  const bg = scene?.appState?.viewBackgroundColor
  return { elements, appState: typeof bg === 'string' && /^(#[0-9a-fA-F]{3,8}|transparent|[a-zA-Z]{3,20})$/.test(bg) ? { viewBackgroundColor: bg } : {} }
}