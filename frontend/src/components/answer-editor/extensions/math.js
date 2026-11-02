import { Node, InputRule, mergeAttributes } from '@tiptap/core'

const latexAttr = {
  latex: {
    default: '',
    parseHTML: (el) => el.getAttribute('data-latex') ?? '',
    renderHTML: (attrs) => ({ 'data-latex': attrs.latex }),
  },
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { inputRule: true }
  },

  addAttributes() {
    return latexAttr
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math-inline' }), `$${node.attrs.latex}$`]
  },

  renderText({ node }) {
    return `$${node.attrs.latex}$`
  },

  addInputRules() {
    if (!this.options.inputRule) return []
    return [
      new InputRule({
        find: /(?:^|[\s(])\$([^$\n]{1,500})\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1]
          if (!latex.trim()) return null
          const start = range.from + match[0].indexOf('$')
          state.tr.replaceWith(start, range.to, this.type.create({ latex }))
        },
      }),
    ]
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return latexAttr
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math-block"]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math-block' }), `$$${node.attrs.latex}$$`]
  },

  renderText({ node }) {
    return `$$${node.attrs.latex}$$`
  },
})