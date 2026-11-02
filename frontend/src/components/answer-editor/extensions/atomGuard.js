import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state'

const PROTECTED = new Set(['mathBlock', 'codeBlock', 'diagram', 'table'])

export const AtomGuard = Extension.create({
  name: 'atomGuard',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('atomGuard'),
        props: {
          handleTextInput(view, _from, _to, text) {
            const sel = view.state.selection
            if (!(sel instanceof NodeSelection) || !PROTECTED.has(sel.node.type.name)) return false
            const { state } = view
            const paragraph = state.schema.nodes.paragraph.create(null, text ? state.schema.text(text) : null)
            const tr = state.tr.insert(sel.to, paragraph)
            tr.setSelection(TextSelection.create(tr.doc, sel.to + 1 + text.length))
            view.dispatch(tr.scrollIntoView())
            return true
          },
        },
      }),
    ]
  },
})