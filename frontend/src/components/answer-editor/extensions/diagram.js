import { Node, mergeAttributes } from '@tiptap/core'
import { sanitizeScene } from '../schema'

export const Diagram = Node.create({
  name: 'diagram',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      scene: {
        default: { elements: [], appState: {} },
        parseHTML: (el) => {
          try {
            return sanitizeScene(JSON.parse(el.getAttribute('data-scene') || '{}'))
          } catch {
            return { elements: [], appState: {} }
          }
        },
        renderHTML: (attrs) => ({ 'data-scene': JSON.stringify(attrs.scene || {}) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="diagram"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'diagram' }), '[diagram]']
  },

  renderText() {
    return '[diagram]'
  },
})