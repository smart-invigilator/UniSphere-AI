import StarterKit from '@tiptap/starter-kit'
import ListItem from '@tiptap/extension-list-item'
import Blockquote from '@tiptap/extension-blockquote'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { BlockIds } from './blockIds'
import { TrailingParagraph } from './trailingParagraph'
import { ModalLock } from './modalLock'
import { AtomGuard } from './atomGuard'
import { ComponentGuard } from './componentGuard'
import { MathInline, MathBlock } from './math'
import { CodeBlock } from './codeBlock'
import { Diagram } from './diagram'
import { COMPONENTS, normalizeAllowed } from '../schema'

const CELL_CONTENT = '(paragraph | bulletList | orderedList | mathBlock)+'

export function createAnswerExtensions({ allowed = COMPONENTS, views = null, placeholder = '', guard = true } = {}) {
  const allow = normalizeAllowed(allowed)
  const withView = (ext, key) => (views?.[key] ? ext.extend({ addNodeView: () => views[key] }) : ext)
  return [
    StarterKit.configure({
      codeBlock: false,
      listItem: false,
      blockquote: false,
      heading: { levels: [1, 2, 3] },
    }),
    ListItem.extend({ content: 'paragraph (paragraph | bulletList | orderedList | mathBlock | codeBlock)*' }),
    Blockquote.extend({ content: '(paragraph | heading | bulletList | orderedList | blockquote | horizontalRule | mathBlock | codeBlock)+' }),
    Underline,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Placeholder.configure({ placeholder }),
    Table.configure({ resizable: false, HTMLAttributes: { class: 'ae-table' } }),
    TableRow,
    TableHeader.extend({ content: CELL_CONTENT }),
    TableCell.extend({ content: CELL_CONTENT }),
    withView(MathInline.configure({ inputRule: allow.includes('math') }), 'mathInline'),
    withView(MathBlock, 'mathBlock'),
    withView(CodeBlock, 'codeBlock'),
    withView(Diagram, 'diagram'),
    BlockIds,
    TrailingParagraph,
    ModalLock,
    AtomGuard,
    ...(guard ? [ComponentGuard.configure({ allowed: allow })] : []),
  ]
}