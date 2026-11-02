import { ReactNodeViewRenderer } from '@tiptap/react'
import MathView from './views/MathView'
import CodeView from './views/CodeView'
import DiagramView from './views/DiagramView'

const stopInside = (selector) => ({ event }) => {
  const target = event.target
  if (!(target instanceof Element)) return false
  return !!target.closest(selector)
}

export const nodeViews = {
  mathInline: ReactNodeViewRenderer(MathView, { as: 'span', className: 'ae-nv-inline' }),
  mathBlock: ReactNodeViewRenderer(MathView),
  codeBlock: ReactNodeViewRenderer(CodeView, { stopEvent: stopInside('.cm-editor, select, button, input') }),
  diagram: ReactNodeViewRenderer(DiagramView, { stopEvent: stopInside('button') }),
}

export const EDITABLE_ATOMS = new Set(['mathInline', 'mathBlock', 'codeBlock', 'diagram'])