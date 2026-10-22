
const API_ORIGIN = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

export const mediaUrl = (path) => (!path ? null : /^https?:/.test(path) ? path : `${API_ORIGIN}${path}`)

export const QUESTION_TYPES = [
  { id: 'mcq', label: 'Multiple Choice', group: 'Choice', marks: 4, hint: 'One correct option' },
  { id: 'msq', label: 'Multiple Answer', group: 'Choice', marks: 4, hint: 'Select all that apply (partial credit)' },
  { id: 'tf', label: 'True / False', group: 'Choice', marks: 2, hint: 'Two options' },
  { id: 'fill_blank', label: 'Fill in the Blanks', group: 'Short response', marks: 4, hint: 'Blanks inside a sentence' },
  { id: 'numeric', label: 'Numeric Answer', group: 'Math', marks: 4, hint: 'A number, with tolerance' },
  { id: 'math_expr', label: 'Math Expression', group: 'Math', marks: 5, hint: 'Algebra answer, equivalent forms accepted' },
  { id: 'matrix', label: 'Matrix / Table', group: 'Math', marks: 6, hint: 'Linear algebra matrices, truth tables' },
  { id: 'matching', label: 'Matching', group: 'Structured', marks: 6, hint: 'Pair items from two columns' },
  { id: 'ordering', label: 'Ordering', group: 'Structured', marks: 4, hint: 'Put steps in the right order' },
  { id: 'hotspot', label: 'Image Hotspot', group: 'Image', marks: 3, hint: 'Click the right spot on a picture' },
  { id: 'short', label: 'Short Answer', group: 'Written (manual grading)', marks: 8, hint: 'Teacher grades; images & math symbols allowed' },
  { id: 'essay', label: 'Essay / Long Answer', group: 'Written (manual grading)', marks: 10, hint: 'Teacher grades; word limit optional' },
]
export const TYPE_GROUPS = [...new Set(QUESTION_TYPES.map((t) => t.group))]
export const typeLabel = (id) => QUESTION_TYPES.find((t) => t.id === id)?.label || id
export const isManualType = (t) => t === 'short' || t === 'essay'

const uid = () => Math.random().toString(36).slice(2, 8)
export const BLANK_RE = /\[\[(\d+)\]\]/g
export const blankCount = (text) => new Set([...String(text || '').matchAll(BLANK_RE)].map((m) => Number(m[1]))).size

export function blankQuestion(type) {
  const meta = QUESTION_TYPES.find((t) => t.id === type)
  const q = {
    localId: `q-${Date.now()}-${uid()}`, type, text: '', marks: meta?.marks ?? 4,
    imageUrl: null, imageAlt: '', scoring: 'partial',
    options: null, correctIndex: 0, correctSet: [],
    blanks: [], numeric: { value: '', tolerance: '0.01', toleranceType: 'absolute', unit: '' },
    expression: '', maxWords: '',
    matrix: { rows: 2, cols: 2, cells: [['', ''], ['', '']], rowLabels: [], colLabels: [] },
    left: [], right: [], pairs: {}, items: [], regions: [],
  }
  if (type === 'mcq') q.options = ['', '', '', '']
  if (type === 'msq') { q.options = ['', '', '', '']; q.correctSet = [false, false, false, false] }
  if (type === 'tf') q.options = ['True', 'False']
  if (type === 'matching') {
    q.left = [{ id: 'l1', text: '' }, { id: 'l2', text: '' }]
    q.right = [{ id: 'r1', text: '' }, { id: 'r2', text: '' }]
    q.pairs = { l1: 'r1', l2: 'r2' }
  }
  if (type === 'ordering') q.items = [{ id: 'i1', text: '' }, { id: 'i2', text: '' }, { id: 'i3', text: '' }]
  return q
}

export function questionFromApi(a) {
  const q = blankQuestion(a.type)
  const cfg = a.config || {}
  const key = a.answer_key || {}
  Object.assign(q, {
    localId: `q-${a.id}`, text: a.text, marks: a.marks, imageUrl: a.image_url || null,
    imageAlt: cfg.image_alt || '', scoring: cfg.scoring || 'partial',
  })
  if (a.type === 'mcq' || a.type === 'tf') {
    q.options = a.options || q.options
    q.correctIndex = Math.max(0, q.options.findIndex((o) => o === a.correct_answer))
  } else if (a.type === 'msq') {
    q.options = a.options || []
    q.correctSet = q.options.map((o) => (key.correct || []).includes(o))
  } else if (a.type === 'essay') q.maxWords = cfg.max_words ?? ''
  else if (a.type === 'fill_blank') {
    q.blanks = (key.blanks || []).map((b) => ({ answers: (b.answers || []).join(' | '), caseSensitive: !!b.case_sensitive }))
  } else if (a.type === 'numeric') {
    q.numeric = { value: String(key.value ?? ''), tolerance: String(key.tolerance ?? 0), toleranceType: key.tolerance_type || 'absolute', unit: cfg.unit || '' }
  } else if (a.type === 'math_expr') q.expression = key.expression || ''
  else if (a.type === 'matrix') {
    q.matrix = { rows: cfg.rows, cols: cfg.cols, cells: key.matrix || [], rowLabels: cfg.row_labels || [], colLabels: cfg.col_labels || [] }
  } else if (a.type === 'matching') { q.left = cfg.left || []; q.right = cfg.right || []; q.pairs = key.pairs || {} }
  else if (a.type === 'ordering') q.items = cfg.items || []
  else if (a.type === 'hotspot') q.regions = key.regions || []
  return q
}

export const splitAlternatives = (s) => String(s || '').split('|').map((x) => x.trim()).filter(Boolean)

export function marksIssue(marks) {
  const value = Number(marks)
  return Number.isInteger(value) && value >= 1 && value <= 1000
    ? null
    : 'Marks must be a whole number between 1 and 1000'
}

export function questionToPayload(q) {
  const config = {}
  const payload = { type: q.type, text: q.text, marks: Number(q.marks) || 1, image_url: q.imageUrl || null }
  if (q.imageUrl && q.imageAlt.trim()) config.image_alt = q.imageAlt.trim()
  switch (q.type) {
    case 'mcq': case 'tf':
      payload.options = q.options; payload.correct_answer = q.options[q.correctIndex] ?? null; break
    case 'msq':
      payload.options = q.options
      payload.answer_key = { correct: q.options.filter((_, i) => q.correctSet[i]) }
      config.scoring = q.scoring; break
    case 'essay':
      if (q.maxWords !== '' && q.maxWords != null) config.max_words = Number(q.maxWords); break
    case 'fill_blank':
      payload.answer_key = { blanks: q.blanks.map((b) => ({ answers: splitAlternatives(b.answers), case_sensitive: !!b.caseSensitive })) }
      config.scoring = q.scoring; break
    case 'numeric':
      payload.answer_key = { value: q.numeric.value, tolerance: Number(q.numeric.tolerance) || 0, tolerance_type: q.numeric.toleranceType }
      if (q.numeric.unit.trim()) config.unit = q.numeric.unit.trim(); break
    case 'math_expr':
      payload.answer_key = { expression: q.expression }; break
    case 'matrix': {
      const m = q.matrix
      payload.answer_key = { matrix: m.cells }
      config.scoring = q.scoring
      if (m.rowLabels.some((x) => x.trim())) config.row_labels = m.rowLabels
      if (m.colLabels.some((x) => x.trim())) config.col_labels = m.colLabels
      break
    }
    case 'matching':
      config.left = q.left; config.right = q.right; config.scoring = q.scoring
      payload.answer_key = { pairs: q.pairs }; break
    case 'ordering':
      config.items = q.items; config.scoring = q.scoring; break
    case 'hotspot':
      payload.answer_key = { regions: q.regions }; break
    default: break
  }
  if (Object.keys(config).length) payload.config = config
  return payload
}
export function questionIssue(q) {
  const marksError = marksIssue(q.marks)
  if (marksError) return marksError
  if (!q.text.trim()) return 'Write the question text'
  const filled = (arr) => arr.every((x) => String(x?.text ?? x).trim())
  switch (q.type) {
    case 'mcq': return q.options.length >= 2 && filled(q.options) ? null : 'Fill in every option'
    case 'msq':
      if (!filled(q.options)) return 'Fill in every option'
      return q.correctSet.some(Boolean) ? null : 'Tick at least one correct option'
    case 'fill_blank': {
      const n = blankCount(q.text)
      if (!n) return 'Add blanks to the text as [[1]], [[2]], …'
      return q.blanks.length === n && q.blanks.every((b) => splitAlternatives(b.answers).length) ? null : 'Give the accepted answer for every blank'
    }
    case 'numeric': return String(q.numeric.value).trim() ? null : 'Enter the correct number'
    case 'math_expr': return q.expression.trim() ? null : 'Enter the correct expression'
    case 'matrix': return q.matrix.cells.every((r) => r.every((c) => String(c).trim())) ? null : 'Fill every cell of the answer matrix'
    case 'matching':
      if (!filled(q.left) || !filled(q.right)) return 'Fill in both columns'
      return q.left.every((l) => q.pairs[l.id]) ? null : 'Choose the match for every left item'
    case 'ordering': return q.items.length >= 2 && filled(q.items) ? null : 'Fill in every step (list them in the CORRECT order)'
    case 'hotspot':
      if (!q.imageUrl) return 'Upload the image first'
      return q.regions.length ? null : 'Drag on the image to mark the correct area'
    default: return null
  }
}

const JSON_TYPES = new Set(['msq', 'fill_blank', 'matrix', 'matching', 'ordering', 'hotspot'])

export const serializeResponse = (val) => (typeof val === 'string' ? val : JSON.stringify(val))

export function parseResponse(q, raw) {
  if (raw == null || raw === '') return undefined
  if (!JSON_TYPES.has(q.type)) return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

export function isAnswered(q, val) {
  if (val == null) return false
  switch (q.type) {
    case 'msq': case 'ordering': return Array.isArray(val) && val.length > 0
    case 'fill_blank': return Array.isArray(val) && val.some((x) => String(x ?? '').trim())
    case 'matrix': return Array.isArray(val) && val.some((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim()))
    case 'matching': return typeof val === 'object' && Object.values(val).some(Boolean)
    case 'hotspot': return typeof val === 'object' && val.x != null && val.y != null
    default: return typeof val === 'string' && val.trim() !== ''
  }
}
