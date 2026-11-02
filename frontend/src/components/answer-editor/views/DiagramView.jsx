import { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { Loader2, PenTool, Trash2, AlertTriangle } from 'lucide-react'
import DiagramEditorDialog from '../DiagramEditorDialog'
import { sceneToSvg } from '../excalidraw'
import { restoreFocus } from '../focus'
import { useDialogState } from '../useDialogState'

export default function DiagramView({ node, editor, getPos, updateAttributes, deleteNode, selected }) {
  const previewRef = useRef(null)
  const scene = node.attrs.scene || { elements: [], appState: {} }
  const count = scene.elements?.length || 0
  const [open, setOpen] = useDialogState(editor)
  const [state, setState] = useState(count ? 'loading' : 'empty')
  const [isNew] = useState(() => !count && editor.isEditable && editor.isFocused)
  const editable = editor.isEditable

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

  useEffect(() => {
    let cancelled = false
    const host = previewRef.current
    if (!host) return undefined
    if (!count) {
      host.replaceChildren()
      setState('empty')
      return undefined
    }
    if (!host.firstChild) setState('loading')
    sceneToSvg(scene)
      .then((svg) => {
        if (cancelled) return
        svg.removeAttribute('width')
        svg.removeAttribute('height')
        svg.setAttribute('role', 'img')
        svg.setAttribute('aria-label', 'Diagram')
        svg.classList.add('ae-diagram-svg')
        host.replaceChildren(svg)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [scene])

  const onSave = (next) => {
    updateAttributes({ scene: next })
    setOpen(false)
    if (typeof getPos === 'function') restoreFocus(editor, getPos(), 'node')
  }

  const onCancel = () => {
    setOpen(false)
    if (!count && isNew) {
      deleteNode()
      editor.view.focus()
    }
  }

  return (
    <NodeViewWrapper className={`ae-diagram ${selected ? 'ae-selected' : ''}`} data-elements={count}>
      <div className="ae-diagram-header" contentEditable={false}>
        <span className="flex items-center gap-1.5"><PenTool className="h-3.5 w-3.5" /> Diagram</span>
        {editable && (
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => setOpen(true)} className="ae-text-btn">Edit diagram</button>
            <button type="button" aria-label="Remove diagram" onClick={() => { deleteNode(); editor.view.focus() }} className="ae-icon-btn">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
      <div
        className={`ae-diagram-body ${editable ? 'ae-clickable' : ''}`}
        contentEditable={false}
        onDoubleClick={() => editable && setOpen(true)}
      >
        <div ref={previewRef} className="ae-diagram-preview" />
        {state === 'loading' && <span className="ae-diagram-note"><Loader2 className="h-4 w-4 animate-spin" /> Rendering diagram…</span>}
        {state === 'empty' && <span className="ae-diagram-note">{editable ? 'Empty diagram — click “Edit diagram” to draw' : 'Empty diagram'}</span>}
        {state === 'error' && <span className="ae-diagram-note text-rose-600"><AlertTriangle className="h-4 w-4" /> The diagram could not be displayed ({count} shapes saved).</span>}
      </div>
      {open && <DiagramEditorDialog scene={scene} onSave={onSave} onCancel={onCancel} />}
    </NodeViewWrapper>
  )
}