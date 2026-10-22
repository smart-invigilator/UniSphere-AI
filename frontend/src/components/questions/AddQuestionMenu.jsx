import { useEffect, useRef, useState } from 'react'
import { Plus, ChevronDown } from 'lucide-react'
import Button from '../common/Button'
import { QUESTION_TYPES, TYPE_GROUPS } from '../../utils/questionTypes'

export default function AddQuestionMenu({ onAdd }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={box} className="relative inline-block">
      <Button size="sm" variant="outline" icon={Plus} iconRight={ChevronDown} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Add question
      </Button>
      {open && (
        <div role="menu" className="absolute left-0 z-30 mt-1 max-h-[26rem] w-[19rem] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {TYPE_GROUPS.map((g) => (
            <div key={g} className="mb-1.5">
              <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g}</p>
              {QUESTION_TYPES.filter((t) => t.group === g).map((t) => (
                <button
                  key={t.id} role="menuitem" type="button"
                  onClick={() => { onAdd(t.id); setOpen(false) }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{t.label}</span>
                  <span className="block text-[11px] text-slate-400">{t.hint}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
