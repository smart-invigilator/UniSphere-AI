import { COMPONENTS, isDocEmpty, parseAnswer, serializeAnswer, usesUnifiedEditor } from '../answer-editor/schema'

export { usesUnifiedEditor }

export const QUESTION_TYPES = [
  { type: 'mcq', label: 'Multiple Choice', short: 'MCQ', marks: 4, auto: true, desc: 'One correct option.' },
  { type: 'multi', label: 'Multiple Answers', short: 'Multi', marks: 4, auto: true, desc: 'Select all that apply, with optional partial credit.' },
  { type: 'tf', label: 'True / False', short: 'T/F', marks: 2, auto: true, desc: 'Binary true or false.' },
  { type: 'short', label: 'Short Answer', short: 'Short', marks: 8, auto: false, desc: 'Brief answer in the unified editor (text, equations, code, diagrams, tables). Graded manually.' },
  { type: 'essay', label: 'Long Answer', short: 'Long', marks: 10, auto: false, desc: 'Detailed mixed-format answer in the unified editor. Graded manually.' },
  { type: 'fill_blank', label: 'Fill in the Blanks', short: 'Blanks', marks: 2, auto: true, desc: 'Type answers into [[1]], [[2]] blanks.' },
  { type: 'dropdown', label: 'Multiple Dropdowns', short: 'Dropdowns', marks: 2, auto: true, desc: 'Pick from inline dropdowns at [[1]], [[2]].' },
  { type: 'numeric', label: 'Numerical Answer', short: 'Numeric', marks: 3, auto: true, desc: 'Exact value with tolerance, or a range.' },
  { type: 'math', label: 'Math Expression / Formula', short: 'Math', marks: 4, auto: true, desc: 'LaTeX answer graded by symbolic equivalence.' },
  { type: 'matrix', label: 'Matrix Answer', short: 'Matrix', marks: 4, auto: true, desc: 'Fill a matrix cell by cell (linear algebra).' },
  { type: 'matching', label: 'Matching', short: 'Matching', marks: 4, auto: true, desc: 'Match each prompt to an answer.' },
  { type: 'ordering', label: 'Ordering / Sequence', short: 'Ordering', marks: 3, auto: true, desc: 'Arrange items in the correct order.' },
  { type: 'hotspot', label: 'Hotspot (Image Click)', short: 'Hotspot', marks: 2, auto: true, desc: 'Click the correct area of an image.' },
  { type: 'file_upload', label: 'File Upload', short: 'Upload', marks: 5, auto: false, desc: 'Upload handwritten work as image or PDF.' },
  { type: 'text_block', label: 'Text / Instructions', short: 'Info', marks: 0, auto: false, desc: 'Passage or instructions, no answer.' },
]

export const TYPE_MAP = Object.fromEntries(QUESTION_TYPES.map((t) => [t.type, t]))
export const typeLabel = (type) => TYPE_MAP[type]?.label || type
export const isAnswerable = (type) => type !== 'text_block'
export const PLACEHOLDER_RE = /\[\[(\d+)\]\]/g
const STRUCTURED = new Set(['multi', 'fill_blank', 'dropdown', 'matrix', 'matching', 'ordering', 'hotspot', 'file_upload'])

export function placeholderCount(text) {
  const nums = new Set()
  for (const m of String(text || '').matchAll(PLACEHOLDER_RE)) nums.add(Number(m[1]))
  return nums.size ? Math.max(...nums) : 0
}

const uid = () => `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const emptyMatrix = (r, c) => Array.from({ length: r }, () => Array.from({ length: c }, () => ''))

export function resizeMatrix(cells, rows, cols) {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cells?.[r]?.[c] ?? ''))
}

function resize(arr, n, fill) {
  const out = (arr || []).slice(0, n)
  while (out.length < n) out.push(typeof fill === 'function' ? fill() : fill)
  return out
}

export function blankQuestion(type) {
  const base = {
    localId: uid(),
    type,
    text: '',
    marks: TYPE_MAP[type]?.marks ?? 1,
    media: [],
    options: null,
    correctIndex: 0,
    correctFlags: [],
    settings: {},
    blankText: [],
    dropdowns: [],
    numeric: { mode: 'exact', value: '', tolerance: '0', min: '', max: '' },
    math: { mode: 'symbolic', answers: [''] },
    matrix: { mode: 'symbolic', cells: emptyMatrix(2, 2) },
    pairs: [{ prompt: '', answer: '' }, { prompt: '', answer: '' }],
    distractors: [],
    items: ['', '', ''],
    regions: [],
    richContent: null,
  }
  if (type === 'mcq') base.options = ['', '', '', '']
  if (type === 'multi') {
    base.options = ['', '', '', '']
    base.correctFlags = [false, false, false, false]
    base.settings = { partial_credit: true, shuffle_options: false }
  }
  if (type === 'tf') base.options = ['True', 'False']
  if (type === 'fill_blank') {
    base.text = 'The capital of France is [[1]].'
    base.blankText = ['']
    base.settings = { case_sensitive: false, partial_credit: true }
  }
  if (type === 'dropdown') {
    base.text = 'The time complexity of binary search is [[1]].'
    base.dropdowns = [{ options: ['', ''], correctIndex: 0 }]
    base.settings = { partial_credit: true }
  }
  if (type === 'numeric') base.settings = { unit: '' }
  if (type === 'matrix') base.settings = { rows: 2, cols: 2, partial_credit: true }
  if (type === 'matching' || type === 'ordering') base.settings = { partial_credit: true }
  if (type === 'short') base.settings = { allowed_components: [...COMPONENTS] }
  if (type === 'essay') base.settings = { word_limit: '', allowed_components: [...COMPONENTS] }
  if (type === 'file_upload') base.settings = { accept: 'both', max_files: 1 }
  return base
}

export function syncPlaceholders(q) {
  const n = placeholderCount(q.text)
  if (q.type === 'fill_blank') return { ...q, blankText: resize(q.blankText, n, '') }
  if (q.type === 'dropdown') return { ...q, dropdowns: resize(q.dropdowns, n, () => ({ options: ['', ''], correctIndex: 0 })) }
  return q
}

export function questionFromApi(q) {
  const base = { ...blankQuestion(q.type), localId: `q-${q.id}-${Math.random().toString(36).slice(2, 6)}` }
  const s = q.settings || {}
  const k = q.answer_key || {}
  const { rich_content: richRaw, ...restSettings } = s
  const out = {
    ...base,
    text: q.text,
    marks: q.marks,
    media: q.media || [],
    settings: { ...base.settings, ...restSettings },
    richContent: richRaw ? parseAnswer(richRaw).doc : null,
  }
  if (q.type === 'mcq' || q.type === 'tf') {
    out.options = q.options || base.options
    out.correctIndex = Math.max(0, out.options.findIndex((o) => o === q.correct_answer))
  }
  if (q.type === 'multi') {
    out.options = q.options || []
    const answers = new Set(k.answers || [])
    out.correctFlags = out.options.map((o) => answers.has(o))
  }
  if (q.type === 'fill_blank') out.blankText = (k.blanks || []).map((b) => b.join(' | '))
  if (q.type === 'dropdown') {
    out.dropdowns = (s.dropdowns || []).map((opts, i) => ({
      options: opts,
      correctIndex: Math.max(0, opts.findIndex((o) => o === (k.answers || [])[i])),
    }))
  }
  if (q.type === 'numeric') {
    out.numeric = {
      mode: k.mode || 'exact',
      value: k.value ?? '',
      tolerance: k.tolerance ?? '0',
      min: k.min ?? '',
      max: k.max ?? '',
    }
  }
  if (q.type === 'math') out.math = { mode: k.mode || 'symbolic', answers: k.answers?.length ? k.answers : [''] }
  if (q.type === 'matrix') {
    const rows = Number(s.rows) || 2
    const cols = Number(s.cols) || 2
    out.matrix = { mode: k.mode || 'symbolic', cells: resizeMatrix(k.cells, rows, cols) }
  }
  if (q.type === 'matching') {
    out.pairs = k.pairs?.length ? k.pairs : base.pairs
    out.distractors = s.distractors || []
  }
  if (q.type === 'ordering') out.items = k.order?.length ? k.order : base.items
  if (q.type === 'hotspot') out.regions = k.regions || []
  if (q.type === 'essay') out.settings.word_limit = s.word_limit ?? ''
  if (usesUnifiedEditor(q.type)) out.settings.allowed_components = Array.isArray(s.allowed_components) ? s.allowed_components : [...COMPONENTS]
  return out
}

const trimList = (list) => (list || []).map((x) => String(x ?? '').trim())

export function questionToPayload(q) {
  const marks = q.type === 'text_block' ? 0 : Number(q.marks)
  const p = {
    type: q.type,
    text: q.text,
    marks,
    media: (q.media || []).map((m) => ({ url: m.url, name: m.name || '', caption: m.caption || '' })),
    options: null,
    correct_answer: null,
    settings: {},
    answer_key: null,
  }
  switch (q.type) {
    case 'mcq':
      p.options = trimList(q.options)
      p.correct_answer = p.options[q.correctIndex] ?? null
      p.settings = { shuffle_options: !!q.settings.shuffle_options }
      break
    case 'tf':
      p.options = ['True', 'False']
      p.correct_answer = q.options?.[q.correctIndex] ?? 'True'
      break
    case 'multi':
      p.options = trimList(q.options)
      p.answer_key = { answers: p.options.filter((_, i) => q.correctFlags?.[i]) }
      p.settings = { shuffle_options: !!q.settings.shuffle_options, partial_credit: q.settings.partial_credit !== false }
      break
    case 'short':
      p.settings = { allowed_components: COMPONENTS.filter((c) => (q.settings.allowed_components || COMPONENTS).includes(c)) }
      break
    case 'essay':
      p.settings = {
        word_limit: q.settings.word_limit ? Number(q.settings.word_limit) : null,
        allowed_components: COMPONENTS.filter((c) => (q.settings.allowed_components || COMPONENTS).includes(c)),
      }
      break
    case 'fill_blank':
      p.answer_key = { blanks: (q.blankText || []).map((t) => String(t).split('|').map((x) => x.trim()).filter(Boolean)) }
      p.settings = { case_sensitive: !!q.settings.case_sensitive, partial_credit: q.settings.partial_credit !== false }
      break
    case 'dropdown':
      p.settings = { dropdowns: q.dropdowns.map((d) => trimList(d.options)), partial_credit: q.settings.partial_credit !== false }
      p.answer_key = { answers: q.dropdowns.map((d) => String(d.options[d.correctIndex] ?? '').trim()) }
      break
    case 'numeric':
      p.settings = { unit: q.settings.unit || '' }
      p.answer_key =
        q.numeric.mode === 'range'
          ? { mode: 'range', min: Number(q.numeric.min), max: Number(q.numeric.max) }
          : { mode: 'exact', value: Number(q.numeric.value), tolerance: Number(q.numeric.tolerance) || 0 }
      break
    case 'math':
      p.answer_key = { mode: q.math.mode, answers: q.math.answers.map((a) => a.trim()).filter(Boolean) }
      break
    case 'matrix':
      p.settings = { rows: Number(q.settings.rows), cols: Number(q.settings.cols), partial_credit: q.settings.partial_credit !== false }
      p.answer_key = {
        mode: q.matrix.mode,
        cells: q.matrix.mode === 'manual' && q.matrix.cells.flat().every((c) => !String(c).trim())
          ? []
          : q.matrix.cells.map((r) => trimList(r)),
      }
      break
    case 'matching':
      p.answer_key = { pairs: q.pairs.map((x) => ({ prompt: x.prompt.trim(), answer: x.answer.trim() })) }
      p.settings = { distractors: trimList(q.distractors).filter(Boolean), partial_credit: q.settings.partial_credit !== false }
      break
    case 'ordering':
      p.answer_key = { order: trimList(q.items) }
      p.settings = { partial_credit: q.settings.partial_credit !== false }
      break
    case 'hotspot':
      p.answer_key = { regions: q.regions }
      break
    case 'file_upload':
      p.settings = { accept: q.settings.accept || 'both', max_files: Number(q.settings.max_files) || 1 }
      break
    default:
      break
  }
  if (q.richContent && !isDocEmpty(q.richContent)) {
    p.settings = { ...p.settings, rich_content: serializeAnswer(q.richContent) }
  }
  return p
}

export const MARKS_MIN = 1
export const MARKS_MAX = 1000

export function marksError(value) {
  if (value === '' || value === null || value === undefined) return 'Enter the marks for this question.'
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Marks must be a number.'
  if (!Number.isInteger(n)) return 'Marks must be a whole number.'
  if (n < MARKS_MIN) return `Marks must be at least ${MARKS_MIN}.`
  if (n > MARKS_MAX) return `Marks cannot be more than ${MARKS_MAX}.`
  return null
}

export function gradeMarksError(value, max) {
  if (value === '' || value === null || value === undefined) return 'Enter the marks to award.'
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Marks must be a number.'
  if (n < 0) return 'Marks cannot be negative.'
  if (n > Number(max)) return `Marks cannot be more than ${max}.`
  if (Math.round(n * 100) !== n * 100 && Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return 'Use at most 2 decimal places.'
  return null
}

const hasDupes = (list) => new Set(list.map((x) => x.toLowerCase())).size !== list.length

export function validateQuestion(q) {
  if (!q.text.trim()) return 'Question text is required.'
  if (q.type !== 'text_block') {
    const m = marksError(q.marks)
    if (m) return m
  }
  const opts = trimList(q.options)
  switch (q.type) {
    case 'mcq':
      if (opts.length < 2 || opts.some((o) => !o)) return 'Fill in every option.'
      if (hasDupes(opts)) return 'Options must be unique.'
      return null
    case 'multi':
      if (opts.length < 2 || opts.some((o) => !o)) return 'Fill in every option.'
      if (hasDupes(opts)) return 'Options must be unique.'
      if (!q.correctFlags?.some(Boolean)) return 'Mark at least one correct option.'
      return null
    case 'fill_blank': {
      const n = placeholderCount(q.text)
      if (!n) return 'Add at least one blank using [[1]] in the question text.'
      if (q.blankText.some((t) => !String(t).split('|').some((x) => x.trim()))) return 'Provide accepted answers for every blank.'
      return null
    }
    case 'dropdown': {
      const n = placeholderCount(q.text)
      if (!n) return 'Add at least one dropdown using [[1]] in the question text.'
      for (const d of q.dropdowns) {
        const o = trimList(d.options)
        if (o.length < 2 || o.some((x) => !x)) return 'Every dropdown needs at least 2 filled options.'
        if (hasDupes(o)) return 'Dropdown options must be unique.'
      }
      return null
    }
    case 'numeric':
      if (q.numeric.mode === 'range') {
        if (q.numeric.min === '' || q.numeric.max === '' || isNaN(Number(q.numeric.min)) || isNaN(Number(q.numeric.max))) return 'Enter a valid minimum and maximum.'
        if (Number(q.numeric.min) > Number(q.numeric.max)) return 'Minimum must be less than maximum.'
      } else if (q.numeric.value === '' || isNaN(Number(q.numeric.value))) return 'Enter the correct numeric value.'
      return null
    case 'math':
      if (q.math.mode !== 'manual' && !q.math.answers.some((a) => a.trim())) return 'Enter at least one correct expression or choose manual grading.'
      return null
    case 'matrix':
      if (q.matrix.mode !== 'manual' && q.matrix.cells.flat().some((c) => !String(c).trim())) return 'Fill every cell of the answer matrix.'
      return null
    case 'matching':
      if (q.pairs.length < 2 || q.pairs.some((p) => !p.prompt.trim() || !p.answer.trim())) return 'Fill in at least 2 complete pairs.'
      if (hasDupes(q.pairs.map((p) => p.prompt.trim()))) return 'Matching prompts must be unique.'
      return null
    case 'ordering': {
      const items = trimList(q.items)
      if (items.length < 2 || items.some((i) => !i)) return 'Fill in at least 2 items.'
      if (hasDupes(items)) return 'Items must be unique.'
      return null
    }
    case 'hotspot':
      if (!q.media?.length) return 'Upload an image for the hotspot.'
      if (!q.regions?.length) return 'Draw at least one correct region on the image.'
      return null
    default:
      return null
  }
}

export function serializeResponse(type, value) {
  if (value === undefined || value === null) return ''
  if (usesUnifiedEditor(type)) return isDocEmpty(value) ? '' : serializeAnswer(value)
  return STRUCTURED.has(type) ? JSON.stringify(value) : String(value)
}

export function parseResponse(type, raw, settings) {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (usesUnifiedEditor(type)) return parseAnswer(raw, settings?.allowed_components).doc
  if (!STRUCTURED.has(type)) return raw
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function isAnswered(type, value) {
  if (value === undefined || value === null) return false
  if (usesUnifiedEditor(type)) return typeof value === 'object' && !isDocEmpty(value)
  if (type === 'hotspot') return typeof value === 'object' && value.x != null
  if (type === 'matching') return typeof value === 'object' && Object.values(value).some((v) => String(v || '').trim())
  if (type === 'file_upload') return Array.isArray(value) && value.length > 0
  if (Array.isArray(value)) return value.flat().some((v) => String(v ?? '').trim())
  return String(value).trim().length > 0
}