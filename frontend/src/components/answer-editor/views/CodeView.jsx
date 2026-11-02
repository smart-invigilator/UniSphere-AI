import { useEffect, useRef } from 'react'
import { NodeViewWrapper } from '@tiptap/react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { Code2, Trash2 } from 'lucide-react'
import { CODE_LANGUAGES, LIMITS } from '../schema'
import { restoreFocus } from '../focus'

const languageExtension = (lang) => {
  if (lang === 'python') return python()
  if (lang === 'javascript') return javascript()
  if (lang === 'java') return java()
  if (lang === 'c' || lang === 'cpp') return cpp()
  return []
}

export default function CodeView({ node, editor, getPos, updateAttributes, deleteNode, selected }) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const syncingRef = useRef(false)
  const langCompartment = useRef(new Compartment())
  const editableCompartment = useRef(new Compartment())
  const editable = editor.isEditable

  useEffect(() => {
    const exitTo = (after) => {
      if (typeof getPos !== 'function') return false
      const pos = getPos()
      restoreFocus(editor, after ? pos + node.nodeSize : pos, after ? 'after' : 'node')
      return true
    }
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: node.attrs.code || '',
        extensions: [
          basicSetup,
          indentUnit.of('    '),
          EditorState.tabSize.of(4),
          keymap.of([
            indentWithTab,
            { key: 'Escape', run: () => exitTo(false) },
            {
              key: 'ArrowUp',
              run: (v) => v.state.doc.lineAt(v.state.selection.main.head).number === 1 && v.state.selection.main.empty && exitTo(false),
            },
            {
              key: 'ArrowDown',
              run: (v) => v.state.doc.lineAt(v.state.selection.main.head).number === v.state.doc.lines && v.state.selection.main.empty && exitTo(true),
            },
          ]),
          langCompartment.current.of(languageExtension(node.attrs.language)),
          editableCompartment.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          EditorState.changeFilter.of((tr) => tr.newDoc.length <= LIMITS.code),
          EditorView.contentAttributes.of({ 'aria-label': 'Code editor' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !syncingRef.current) updateAttributes({ code: u.state.doc.toString() })
          }),
        ],
      }),
    })
    viewRef.current = view
    if (editable && !node.attrs.code && editor.isFocused) requestAnimationFrame(() => view.focus())
    return () => view.destroy()
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== (node.attrs.code || '')) {
      syncingRef.current = true
      view.dispatch({ changes: { from: 0, to: current.length, insert: node.attrs.code || '' } })
      syncingRef.current = false
    }
  }, [node.attrs.code])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: langCompartment.current.reconfigure(languageExtension(node.attrs.language)) })
  }, [node.attrs.language])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartment.current.reconfigure([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
    })
  }, [editable])

  useEffect(() => {
    const handler = ({ pos }) => {
      if (typeof getPos === 'function' && getPos() === pos) viewRef.current?.focus()
    }
    editor.on('openNodeEditor', handler)
    return () => editor.off('openNodeEditor', handler)
  }, [editor, getPos])

  const label = CODE_LANGUAGES.find((l) => l.id === node.attrs.language)?.label || 'Code'

  return (
    <NodeViewWrapper className={`ae-code ${selected ? 'ae-selected' : ''}`} data-language={node.attrs.language}>
      <div className="ae-code-header" contentEditable={false}>
        <span className="flex items-center gap-1.5">
          <Code2 className="h-3.5 w-3.5" />
          {editable ? (
            <select
              aria-label="Code language"
              value={node.attrs.language}
              onChange={(e) => updateAttributes({ language: e.target.value })}
              className="ae-code-lang"
            >
              {CODE_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          ) : (
            <span>{label}</span>
          )}
        </span>
        {editable && (
          <span className="flex items-center gap-2">
            <span className="hidden text-[10px] text-slate-400 sm:inline">Tab indents · Esc to leave</span>
            <button type="button" aria-label="Remove code block" onClick={() => { deleteNode(); editor.view.focus() }} className="ae-icon-btn">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
      <div ref={hostRef} className="ae-code-body" contentEditable={false} />
    </NodeViewWrapper>
  )
}