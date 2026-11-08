import { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { AlertCircle, CheckCircle2, CloudOff, Loader2, PencilLine } from 'lucide-react'
import Toolbar from './Toolbar'
import { createAnswerExtensions } from './extensions'
import { nodeViews, EDITABLE_ATOMS } from './nodeViews'
import { countWords, emptyDoc, normalizeAllowed, LIMITS, serializeAnswer } from './schema'
import './editor.css'

const STATUS = {
  idle: null,
  unsaved: { icon: PencilLine, text: 'Unsaved changes', cls: 'text-slate-500' },
  saving: { icon: Loader2, text: 'Saving…', cls: 'text-slate-500', spin: true },
  saved: { icon: CheckCircle2, text: 'Saved', cls: 'text-emerald-600' },
  retrying: { icon: CloudOff, text: 'Connection problem — your work is kept on this device and will be retried', cls: 'text-amber-600' },
  error: { icon: AlertCircle, text: 'Not saved', cls: 'text-rose-600' },
}

export function SaveStatus({ status, error }) {
  const s = STATUS[status]
  if (!s) return null
  const Icon = s.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${s.cls}`} role="status" aria-live="polite" data-testid="save-status" data-status={status}>
      <Icon className={`h-3.5 w-3.5 ${s.spin ? 'animate-spin' : ''}`} />
      {s.text}
      {status === 'error' && error?.message ? `: ${error.message}` : ''}
    </span>
  )
}

export default function UnifiedAnswerEditor({
  value,
  onChange,
  allowedComponents,
  readOnly = false,
  placeholder = 'Write your answer…',
  wordLimit = null,
  saveStatus = 'idle',
  saveError = null,
  ariaLabel = 'Answer editor',
  variant = 'full',
  toolbarExtra = null,
  showFooter = true,
}) {
  const allowed = useMemo(() => normalizeAllowed(allowedComponents), [JSON.stringify(allowedComponents ?? null)])
  const onChangeRef = useRef(onChange)
  const lastEmitted = useRef(null)
  const sizeWarning = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const extensions = useMemo(() => createAnswerExtensions({ allowed, views: nodeViews, placeholder }), [allowed, placeholder])

  const editor = useEditor(
    {
      extensions,
      content: value || emptyDoc(),
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: 'ae-prose',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': ariaLabel,
          spellcheck: 'true',
        },
        handleKeyDown: (view, event) => {
          const sel = view.state.selection
          if (event.key === 'Enter' && sel instanceof NodeSelection && EDITABLE_ATOMS.has(sel.node.type.name)) {
            event.preventDefault()
            view.dom.dispatchEvent(new CustomEvent('ae-open-node', { detail: { pos: sel.from } }))
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor: ed }) => {
        const doc = ed.getJSON()
        const size = serializeAnswer(doc).length
        sizeWarning.current = size > LIMITS.documentBytes
        lastEmitted.current = doc
        onChangeRef.current?.(doc)
      },
    },
    [extensions],
  )

  useEffect(() => {
    if (!editor) return undefined
    const dom = editor.view.dom
    const handler = (e) => editor.emit('openNodeEditor', e.detail)
    dom.addEventListener('ae-open-node', handler)
    return () => dom.removeEventListener('ae-open-node', handler)
  }, [editor])

  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly, false)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor || !value || value === lastEmitted.current) return
    if (JSON.stringify(value) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(value, false)
    }
  }, [editor, value])

  const words = editor ? countWords(editor.getJSON()) : 0

  return (
    <div className={`ae-shell ${readOnly ? 'ae-readonly' : ''}`} data-testid="unified-editor">
      {!readOnly && <Toolbar editor={editor} allowed={allowed} variant={variant} extra={toolbarExtra} />}
      <EditorContent editor={editor} className="ae-content" />
      {showFooter && (
      <div className="ae-footer">
        <span className={wordLimit && words > wordLimit ? 'font-semibold text-rose-600' : ''}>
          {words} word{words === 1 ? '' : 's'}{wordLimit ? ` / ${wordLimit}` : ''}
        </span>
        {sizeWarning.current && <span className="text-rose-600">This answer is too large to save — remove some content.</span>}
        <SaveStatus status={saveStatus} error={saveError} />
      </div>
      )}
    </div>
  )
}