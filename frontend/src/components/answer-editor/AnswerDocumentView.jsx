import { useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { AlertTriangle } from 'lucide-react'
import MathText from '../math/MathText'
import { createAnswerExtensions } from './extensions'
import { nodeViews } from './nodeViews'
import { COMPONENTS, parseAnswer } from './schema'
import './editor.css'

function ReadOnlyDocument({ doc }) {
  const extensions = useMemo(() => createAnswerExtensions({ allowed: COMPONENTS, views: nodeViews, guard: false }), [])
  const editor = useEditor({ extensions, content: doc, editable: false, editorProps: { attributes: { class: 'ae-prose', 'aria-readonly': 'true', 'aria-label': 'Submitted answer' } } }, [doc])
  return <EditorContent editor={editor} className="ae-content" />
}

export default function AnswerDocumentView({ response, emptyText = 'No answer submitted' }) {
  const parsed = useMemo(() => parseAnswer(response), [response])
  if (!response) return <span className="italic text-slate-400">{emptyText}</span>
  if (parsed.error) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-1 text-xs font-medium text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> {parsed.error}. Showing the raw saved data.</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100 p-2 text-[11px] dark:bg-slate-900">{parsed.legacyText}</pre>
      </div>
    )
  }
  if (parsed.legacyText !== null) return <MathText text={parsed.legacyText} />
  return (
    <div className="ae-shell ae-readonly" data-testid="answer-view">
      <ReadOnlyDocument doc={parsed.doc} />
    </div>
  )
}