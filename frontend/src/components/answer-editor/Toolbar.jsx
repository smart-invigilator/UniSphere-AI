import { useState } from 'react'
import {
  Bold, Italic, Underline, Strikethrough, Code, List, ListOrdered, Quote, AlignLeft, AlignCenter, AlignRight,
  Undo2, Redo2, Sigma, SquareFunction, Code2, PenTool, Table2, Rows3, Columns3, Trash2, Heading1, Heading2, Heading3, Pilcrow,
} from 'lucide-react'
import { COMPONENT_LABELS } from './schema'

function Btn({ onClick, active, disabled, label, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : !!active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`ae-tb-btn ${active ? 'ae-tb-active' : ''}`}
    >
      {children}
    </button>
  )
}

function InsertBtn({ onClick, disabled, label, icon: Icon, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      title={disabled ? `${label} can't be inserted here` : `Insert ${label.toLowerCase()}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="ae-insert-btn"
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  )
}

const Sep = () => <span className="ae-tb-sep" aria-hidden="true" />

export default function Toolbar({ editor, allowed }) {
  const [tableForm, setTableForm] = useState(null)
  if (!editor) return null
  const inTable = editor.isActive('table')
  const can = (c) => allowed.includes(c)
  const chain = () => editor.chain().focus()

  const insertBlock = (content) => {
    chain().insertContent(content).run()
  }

  const level = [1, 2, 3].find((l) => editor.isActive('heading', { level: l }))

  return (
    <div className="ae-toolbar" role="toolbar" aria-label="Answer formatting">
      <div className="ae-tb-row">
        <Btn label="Undo (Ctrl+Z)" onClick={() => chain().undo().run()} disabled={!editor.can().undo()}><Undo2 className="h-4 w-4" /></Btn>
        <Btn label="Redo (Ctrl+Shift+Z)" onClick={() => chain().redo().run()} disabled={!editor.can().redo()}><Redo2 className="h-4 w-4" /></Btn>
        <Sep />
        <Btn label="Normal text" active={!level} onClick={() => chain().setParagraph().run()}><Pilcrow className="h-4 w-4" /></Btn>
        <Btn label="Heading 1" active={level === 1} onClick={() => chain().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></Btn>
        <Btn label="Heading 2" active={level === 2} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></Btn>
        <Btn label="Heading 3" active={level === 3} onClick={() => chain().toggleHeading({ level: 3 }).run()}><Heading3 className="h-4 w-4" /></Btn>
        <Sep />
        <Btn label="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}><Bold className="h-4 w-4" /></Btn>
        <Btn label="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}><Italic className="h-4 w-4" /></Btn>
        <Btn label="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()}><Underline className="h-4 w-4" /></Btn>
        <Btn label="Strikethrough" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></Btn>
        <Btn label="Inline code" active={editor.isActive('code')} onClick={() => chain().toggleCode().run()}><Code className="h-4 w-4" /></Btn>
        <Sep />
        <Btn label="Bullet list" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}><List className="h-4 w-4" /></Btn>
        <Btn label="Numbered list" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></Btn>
        <Btn label="Quote" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()} disabled={inTable}><Quote className="h-4 w-4" /></Btn>
        <Sep />
        <Btn label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => chain().setTextAlign('left').run()}><AlignLeft className="h-4 w-4" /></Btn>
        <Btn label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => chain().setTextAlign('center').run()}><AlignCenter className="h-4 w-4" /></Btn>
        <Btn label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => chain().setTextAlign('right').run()}><AlignRight className="h-4 w-4" /></Btn>
      </div>

      {allowed.length > 0 && (
        <div className="ae-tb-row ae-insert-row" role="group" aria-label="Insert into answer">
          <span className="ae-insert-label">Insert:</span>
          {can('math') && (
            <>
              <InsertBtn testId="insert-math-inline" label="Inline equation" icon={Sigma} onClick={() => chain().insertContent({ type: 'mathInline', attrs: { latex: '' } }).run()} />
              <InsertBtn testId="insert-math-block" label="Display equation" icon={SquareFunction} onClick={() => insertBlock({ type: 'mathBlock', attrs: { latex: '' } })} />
            </>
          )}
          {can('code') && <InsertBtn testId="insert-code" label="Code" icon={Code2} disabled={inTable} onClick={() => insertBlock({ type: 'codeBlock', attrs: { language: 'python', code: '' } })} />}
          {can('diagram') && <InsertBtn testId="insert-diagram" label="Diagram" icon={PenTool} disabled={inTable} onClick={() => insertBlock({ type: 'diagram', attrs: { scene: { elements: [], appState: {} } } })} />}
          {can('table') && (
            <span className="relative">
              <InsertBtn testId="insert-table" label="Table" icon={Table2} disabled={inTable} onClick={() => setTableForm(tableForm ? null : { rows: 3, cols: 3, header: true })} />
              {tableForm && (
                <div className="ae-popover" role="dialog" aria-label="Insert table">
                  <label>Rows <input type="number" min={1} max={30} value={tableForm.rows} onChange={(e) => setTableForm({ ...tableForm, rows: e.target.value })} /></label>
                  <label>Columns <input type="number" min={1} max={10} value={tableForm.cols} onChange={(e) => setTableForm({ ...tableForm, cols: e.target.value })} /></label>
                  <label className="ae-check"><input type="checkbox" checked={tableForm.header} onChange={(e) => setTableForm({ ...tableForm, header: e.target.checked })} /> Header row</label>
                  <button
                    type="button"
                    data-testid="insert-table-confirm"
                    className="ae-primary-btn"
                    onClick={() => {
                      const rows = Math.min(30, Math.max(1, Number(tableForm.rows) || 1))
                      const cols = Math.min(10, Math.max(1, Number(tableForm.cols) || 1))
                      chain().insertTable({ rows, cols, withHeaderRow: tableForm.header }).run()
                      setTableForm(null)
                    }}
                  >
                    Insert {Math.min(30, Math.max(1, Number(tableForm.rows) || 1))}×{Math.min(10, Math.max(1, Number(tableForm.cols) || 1))}
                  </button>
                </div>
              )}
            </span>
          )}
        </div>
      )}

      {inTable && (
        <div className="ae-tb-row ae-table-row" role="group" aria-label="Table controls">
          <span className="ae-insert-label">Table:</span>
          <button type="button" className="ae-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addRowBefore().run()}><Rows3 className="h-3.5 w-3.5" /> Row above</button>
          <button type="button" className="ae-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addRowAfter().run()}><Rows3 className="h-3.5 w-3.5" /> Row below</button>
          <button type="button" className="ae-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addColumnBefore().run()}><Columns3 className="h-3.5 w-3.5" /> Column left</button>
          <button type="button" className="ae-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addColumnAfter().run()}><Columns3 className="h-3.5 w-3.5" /> Column right</button>
          <button type="button" className="ae-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteRow().run()}>Delete row</button>
          <button type="button" className="ae-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteColumn().run()}>Delete column</button>
          <button type="button" className="ae-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleHeaderRow().run()}>Header row</button>
          <button type="button" className="ae-chip ae-chip-danger" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteTable().run()}><Trash2 className="h-3.5 w-3.5" /> Delete table</button>
        </div>
      )}
      <span className="sr-only">Allowed content: text{allowed.map((c) => `, ${COMPONENT_LABELS[c].toLowerCase()}`).join('')}</span>
    </div>
  )
}