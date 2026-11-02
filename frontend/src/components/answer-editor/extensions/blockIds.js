import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const BLOCK_ID_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'mathBlock', 'codeBlock', 'diagram', 'table']

export const newBlockId = () => `b${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`

function assignIds(state) {
  const tr = state.tr
  const seen = new Set()
  let changed = false
  state.doc.descendants((node, pos) => {
    if (!BLOCK_ID_TYPES.includes(node.type.name)) return true
    const id = node.attrs.id
    if (!id || seen.has(id)) {
      const fresh = newBlockId()
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh })
      seen.add(fresh)
      changed = true
    } else {
      seen.add(id)
    }
    return true
  })
  return changed ? tr.setMeta('addToHistory', false) : null
}

export const BlockIds = Extension.create({
  name: 'blockIds',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_ID_TYPES,
        attributes: {
          id: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-block-id'),
            renderHTML: (attrs) => (attrs.id ? { 'data-block-id': attrs.id } : {}),
          },
        },
      },
    ]
  },

  onCreate() {
    if (!this.editor.isEditable) return
    const tr = assignIds(this.editor.state)
    if (tr) this.editor.view.dispatch(tr)
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('blockIds'),
        appendTransaction: (transactions, _old, state) => {
          if (!editor.isEditable || !transactions.some((t) => t.docChanged)) return null
          return assignIds(state)
        },
      }),
    ]
  },
})