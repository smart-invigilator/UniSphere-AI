import { NodeSelection, TextSelection } from '@tiptap/pm/state'

export function restoreFocus(editor, pos, mode = 'after') {
  if (!editor || editor.isDestroyed || typeof pos !== 'number') return
  const { state, view } = editor
  const docSize = state.doc.content.size
  const clamped = Math.max(0, Math.min(pos, docSize))
  let selection
  if (mode === 'node') {
    try {
      selection = NodeSelection.create(state.doc, clamped)
    } catch {
      selection = TextSelection.near(state.doc.resolve(clamped))
    }
  } else {
    selection = TextSelection.near(state.doc.resolve(clamped))
  }
  view.dispatch(state.tr.setSelection(selection))
  view.focus()
}