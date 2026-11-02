import { Node, mergeAttributes } from '@tiptap/core'
import { CODE_LANGUAGES } from '../schema'

const LANG_IDS = new Set(CODE_LANGUAGES.map((l) => l.id))

export const CodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  code: true,
  defining: true,

  addAttributes() {
    return {
      language: {
        default: 'python',
        parseHTML: (el) => {
          const lang = el.getAttribute('data-language')
          return LANG_IDS.has(lang) ? lang : 'plaintext'
        },
        renderHTML: (attrs) => ({ 'data-language': attrs.language }),
      },
      code: {
        default: '',
        parseHTML: (el) => el.textContent || '',
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'pre', preserveWhitespace: 'full' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-type': 'code-block' }), ['code', {}, node.attrs.code]]
  },

  renderText({ node }) {
    return node.attrs.code
  },
})