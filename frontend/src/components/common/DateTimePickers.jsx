import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'

// Dropdown pickers for exam scheduling. Values use plain strings so they stay
// time-zone neutral: date = "YYYY-MM-DD", time = "HH:mm" (24-hour).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const pad = (n) => String(n).padStart(2, '0')
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const parseKey = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null
}

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, setOpen, ref }
}

const triggerCls = (error, open) =>
  `flex w-full items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2.5 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:bg-slate-800 dark:text-white ${
    error ? 'border-rose-400 ring-1 ring-rose-300'
      : open ? 'border-brand-500 bg-white ring-2 ring-brand-500/20 dark:bg-slate-800'
        : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
  }`

const popCls = 'absolute left-0 top-full z-30 mt-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900'

function Label({ children }) {
  return <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{children}</label>
}

export function DatePicker({ label, value, onChange, min, error, placeholder = 'Select a date' }) {
  const { open, setOpen, ref } = usePopover()
  const sel = parseKey(value)
  const minP = parseKey(min)
  const today = parseKey(min) || null
  const seed = sel || today || { y: new Date().getFullYear(), m: new Date().getMonth(), d: 1 }
  const [view, setView] = useState({ y: seed.y, m: seed.m })

  useEffect(() => {
    if (open) setView({ y: seed.y, m: seed.m })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay()
    const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate()
    return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  }, [view])

  const shift = (delta) => setView(({ y, m }) => {
    const t = m + delta
    return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 }
  })

  const isDisabled = (d) => !!minP && toKey(view.y, view.m, d) < toKey(minP.y, minP.m, minP.d)
  const display = sel
    ? new Date(Date.UTC(sel.y, sel.m, sel.d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null

  return (
    <div ref={ref} className="relative">
      {label && <Label>{label}</Label>}
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={triggerCls(error, open)}>
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-brand-600" />
          <span className={display ? '' : 'text-slate-400'}>{display || placeholder}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="dialog" aria-label="Choose a date" className={`${popCls} w-72`}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{MONTHS[view.m]} {view.y}</span>
            <button type="button" aria-label="Next month" onClick={() => shift(1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => <span key={w} className="py-1 text-[10px] font-semibold uppercase text-slate-400">{w}</span>)}
            {cells.map((d, i) => {
              if (d == null) return <span key={`e${i}`} />
              const key = toKey(view.y, view.m, d)
              const selected = key === value
              const isToday = !!minP && key === toKey(minP.y, minP.m, minP.d)
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isDisabled(d)}
                  onClick={() => { onChange(key); setOpen(false) }}
                  className={`h-8 rounded-lg text-xs font-medium transition ${
                    selected ? 'bg-brand-600 text-white'
                      : isDisabled(d) ? 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                        : `text-slate-700 hover:bg-brand-50 dark:text-slate-200 dark:hover:bg-brand-500/10 ${isToday ? 'ring-1 ring-brand-300' : ''}`
                  }`}
                >
                  {d}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
            {minP ? (
              <button type="button" onClick={() => { onChange(toKey(minP.y, minP.m, minP.d)); setOpen(false) }} className="text-xs font-semibold text-brand-600 hover:underline">Today</button>
            ) : <span />}
            {value && <button type="button" onClick={() => { onChange(''); setOpen(false) }} className="text-xs font-semibold text-slate-500 hover:text-rose-600">Clear</button>}
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] font-medium text-rose-600" role="alert">{error}</p>}
    </div>
  )
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

function Column({ title, children }) {
  return (
    <div className="flex w-16 flex-col">
      <span className="mb-1 text-center text-[10px] font-semibold uppercase text-slate-400">{title}</span>
      <div className="max-h-48 space-y-1 overflow-y-auto pr-0.5">{children}</div>
    </div>
  )
}

function Option({ active, onClick, children }) {
  return (
    <button
      type="button"
      ref={(el) => { if (el && active) el.scrollIntoView({ block: 'nearest' }) }}
      onClick={onClick}
      className={`block w-full rounded-lg py-1.5 text-center text-sm font-medium transition ${
        active ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-brand-50 dark:text-slate-200 dark:hover:bg-brand-500/10'
      }`}
    >
      {children}
    </button>
  )
}

export function TimePicker({ label, value, onChange, error, placeholder = 'Select a time' }) {
  const { open, setOpen, ref } = usePopover()
  const m = /^(\d{2}):(\d{2})$/.exec(value || '')
  const h24 = m ? +m[1] : null
  const min = m ? +m[2] : null
  const period = h24 == null ? null : h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 == null ? null : h24 % 12 === 0 ? 12 : h24 % 12

  const commit = (nextH12, nextMin, nextPeriod) => {
    const hh = (nextH12 % 12) + (nextPeriod === 'PM' ? 12 : 0)
    onChange(`${pad(hh)}:${pad(nextMin)}`)
  }
  const display = m ? `${h12}:${pad(min)} ${period}` : null

  return (
    <div ref={ref} className="relative">
      {label && <Label>{label}</Label>}
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={triggerCls(error, open)}>
        <span className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-brand-600" />
          <span className={display ? '' : 'text-slate-400'}>{display || placeholder}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="dialog" aria-label="Choose a time" className={popCls}>
          <div className="flex gap-2">
            <Column title="Hour">
              {HOURS_12.map((h) => (
                <Option key={h} active={h === h12} onClick={() => commit(h, min ?? 0, period ?? 'AM')}>{h}</Option>
              ))}
            </Column>
            <Column title="Min">
              {MINUTES.map((mi) => (
                <Option key={mi} active={mi === min} onClick={() => commit(h12 ?? 9, mi, period ?? 'AM')}>{pad(mi)}</Option>
              ))}
            </Column>
            <Column title="AM/PM">
              {['AM', 'PM'].map((p) => (
                <Option key={p} active={p === period} onClick={() => commit(h12 ?? 9, min ?? 0, p)}>{p}</Option>
              ))}
            </Column>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
            {value ? <button type="button" onClick={() => onChange('')} className="text-xs font-semibold text-slate-500 hover:text-rose-600">Clear</button> : <span />}
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700">Done</button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] font-medium text-rose-600" role="alert">{error}</p>}
    </div>
  )
}
