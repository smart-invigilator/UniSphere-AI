import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const ModalLock = Extension.create({
  name: 'modalLock',

  addStorage() {
    return { count: 0 }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    const locked = () => storage.count > 0
    return [
      new Plugin({
        key: new PluginKey('modalLock'),
        props: {
          handleKeyDown: () => locked(),
          handleKeyPress: () => locked(),
          handleTextInput: () => locked(),
          handlePaste: () => locked(),
          handleDrop: () => locked(),
          handleDOMEvents: {
            beforeinput: (_view, event) => {
              if (!locked()) return false
              event.preventDefault()
              return true
            },
          },
        },
      }),
    ]
  },
})