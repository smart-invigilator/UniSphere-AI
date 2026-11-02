import { useEffect, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { AlertTriangle, Sigma } from 'lucide-react'
import MathEditorDialog from '../MathEditorDialog'
import { renderMathSafe } from '../mathRender'
import { restoreFocus } from '../focus'
import { useDialogState } from '../useDialogState'

export default function MathView({ node, editor, getPos, updateAttributes, deleteNode, selected }) {
  const display = node.type.name === 'mathBlock'
  const latex = node.attrs.latex || ''
  const [open, setOpen] = useDialogState(editor)
  const [isNew] = useState(() => !latex && editor.isEditable && editor.isFocused)

  useEffect(() => {
    if (isNew) setOpen(true)
  }, [isNew])

  useEffect(() => {
    const handler = ({ pos }) => {
      if (editor.isEditable && typeof getPos === 'function' && getPos() === pos) setOpen(true)
    }
    editor.on('openNodeEditor', handler)
    return () => editor.off('openNodeEditor', handler)
  }, [editor, getPos])

  const rendered = latex.trim() ? renderMathSafe(latex, display) : null
  const Tag = display ? 'div' : 'span'

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus && editor.isEditable && typeof getPos === 'function') {
      restoreFocus(editor, getPos() + node.nodeSize, 'after')
    }
  }

  const onCancel = () => {
    if (!latex.trim()) {
      setOpen(false)
      deleteNode()
      editor.view.focus()
      return
    }
    close()
  }

  const onSave = (value) => {
    if (!value.trim()) {
      setOpen(false)
      deleteNode()
      editor.view.focus()
      return
    }
    updateAttributes({ latex: value })
    close()
  }

  return (
    <NodeViewWrapper as={Tag} className={display ? 'ae-math-block' : 'ae-math-inline'} data-latex={latex}>
      <Tag
        className={`ae-math ${selected ? 'ae-selected' : ''} ${editor.isEditable ? 'ae-clickable' : ''}`}
        title={editor.isEditable ? 'Click to edit equation' : latex}
        onClick={() => editor.isEditable && setOpen(true)}
        contentEditable={false}
      >
        {!rendered ? (
          <span className="ae-math-empty"><Sigma className="inline h-3.5 w-3.5" /> Empty equation</span>
        ) : rendered.error ? (
          <span className="ae-math-error" role="note">
            <AlertTriangle className="inline h-3.5 w-3.5" /> <code>{latex}</code>
            <span className="ae-math-error-msg">{rendered.error}</span>
          </span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: rendered.html }} />
        )}
      </Tag>
      {open && (
        <MathEditorDialog
          initialLatex={latex}
          display={display}
          onSave={onSave}
          onCancel={onCancel}
          onDelete={() => {
            setOpen(false)
            deleteNode()
            editor.view.focus()
          }}
        />
      )}
    </NodeViewWrapper>
  )
}