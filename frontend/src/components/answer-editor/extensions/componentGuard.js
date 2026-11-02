import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import { COMPONENT_OF, COMPONENTS } from '../schema'

function countBlocked(doc, blocked) {
  let n = 0
  doc.descendants((node) => {
    if (blocked.has(node.type.name)) n += 1
    return true
  })
  return n
}

function stripFragment(fragment, blocked) {
  const out = []
  fragment.forEach((node) => {
    if (blocked.has(node.type.name)) return
    if (node.isLeaf || !node.content.size) {
      out.push(node)
      return
    }
    try {
      out.push(node.copy(stripFragment(node.content, blocked)))
    } catch {
      out.push(node)
    }
  })
  return Fragment.from(out)
}

export const ComponentGuard = Extension.create({
  name: 'componentGuard',

  addOptions() {
    return { allowed: COMPONENTS }
  },

  addProseMirrorPlugins() {
    const allowed = new Set(this.options.allowed)
    const blocked = new Set(Object.entries(COMPONENT_OF).filter(([, c]) => !allowed.has(c)).map(([t]) => t))
    if (!blocked.size) return []
    return [
      new Plugin({
        key: new PluginKey('componentGuard'),
        filterTransaction(tr, state) {
          if (!tr.docChanged) return true
          return countBlocked(tr.doc, blocked) <= countBlocked(state.doc, blocked)
        },
        props: {
          transformPasted(slice) {
            return new Slice(stripFragment(slice.content, blocked), slice.openStart, slice.openEnd)
          },
        },
      }),
    ]
  },
})