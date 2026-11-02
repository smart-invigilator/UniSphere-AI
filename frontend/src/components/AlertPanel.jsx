import { useState } from 'react'
import { Bell, Check, FileDown, MessageSquarePlus, Eye } from 'lucide-react'
import Avatar from './Avatar'
import SeverityTag from './SeverityTag'
import { clockTime } from '../utils/format'
import { useMonitor } from '../context/MonitorContext'

export default function AlertPanel({ onView }) {
  const { alerts, reviewAlert, noteAlert } = useMonitor()
  const [noteFor, setNoteFor] = useState(null)
  const [noteText, setNoteText] = useState('')

  const exportReport = () => {
    const rows = [['Alert ID', 'Student', 'Type', 'Severity', 'Time', 'Reviewed', 'Notes']]
    alerts.forEach((a) =>
      rows.push([a.id, a.studentName, a.type, a.severity, clockTime(a.timestamp), a.reviewed ? 'Yes' : 'No', a.notes || ''])
    )
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `alert-report-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-800">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Bell className="h-4 w-4 text-brand-600" />
          Alert Center
          {alerts.filter((a) => !a.reviewed).length > 0 && (
            <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
              {alerts.filter((a) => !a.reviewed).length}
            </span>
          )}
        </h3>
        <button
          onClick={exportReport}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <FileDown className="h-3.5 w-3.5" /> Export
        </button>
      </div>

      <div className="flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800" style={{ maxHeight: 420 }}>
        {alerts.length === 0 && (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-400">
            <Bell className="h-6 w-6" />
            <p className="text-xs">No alerts yet. Monitoring is active.</p>
          </div>
        )}
        {alerts.map((a) => (
          <div key={a.id} className={`p-3 transition-colors ${a.reviewed ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-2.5">
              <Avatar name={a.studentName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">{a.studentName}</p>
                  <SeverityTag severity={a.severity} />
                </div>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{a.type}</p>
                <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                  {a.id} · {clockTime(a.timestamp)} · {Math.round(a.confidence * 100)}% conf.
                </p>

                {noteFor === a.id ? (
                  <div className="mt-2 flex gap-1">
                    <input
                      autoFocus
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add a note…"
                      className="flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <button
                      onClick={() => { noteAlert(a.id, noteText); setNoteFor(null); setNoteText('') }}
                      className="rounded bg-brand-600 px-2 text-[11px] font-medium text-white"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  a.notes && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-[10px] italic text-slate-500 dark:bg-slate-800">{a.notes}</p>
                )}

                <div className="mt-2 flex items-center gap-1">
                  <button onClick={() => onView(a.studentId)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10">
                    <Eye className="h-3 w-3" /> View
                  </button>
                  {!a.reviewed && (
                    <button onClick={() => reviewAlert(a.id)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10">
                      <Check className="h-3 w-3" /> Reviewed
                    </button>
                  )}
                  <button onClick={() => { setNoteFor(a.id); setNoteText(a.notes || '') }} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <MessageSquarePlus className="h-3 w-3" /> Note
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
