import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('trailingParagraph'),
        appendTransaction: (_trs, _old, state) => {
          if (!editor.isEditable) return null
          const last = state.doc.lastChild
          if (last && last.type.name === 'paragraph') return null
          return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create()).setMeta('addToHistory', false)
        },
      }),
    ]
  },
})