import { FileText, MapPin } from 'lucide-react'
import MathText, { LatexBlock } from '../math/MathText'
import { api } from '../../services/api'
import { parseResponse, isAnswered, usesUnifiedEditor } from './questionTypes'
import AnswerDocumentView from '../answer-editor/AnswerDocumentView'

const Empty = () => <span className="italic text-slate-400">No answer submitted</span>

function Matrix({ cells }) {
  const cols = cells?.[0]?.length || 1
  return (
    <div className="inline-flex items-stretch gap-1">
      <span className="w-1.5 rounded-l border-y-2 border-l-2 border-slate-400" />
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(2.5rem, auto))` }}>
        {cells.map((row, r) =>
          row.map((v, c) => (
            <span
              key={`${r}-${c}`}
              className="rounded bg-white px-2 py-1 text-center font-mono text-xs dark:bg-slate-900"
            >
              {v || '—'}
            </span>
          )),
        )}
      </div>
      <span className="w-1.5 rounded-r border-y-2 border-r-2 border-slate-400" />
    </div>
  )
}

function StudentAnswer({ q, value }) {
  if (!isAnswered(q.type, value)) return <Empty />
  const k = q.answer_key || {}
  switch (q.type) {
    case 'multi':
      return <MathText text={value.join(', ')} />
    case 'fill_blank':
    case 'dropdown':
      return (
        <ol className="list-decimal space-y-0.5 pl-5">
          {value.map((v, i) => <li key={i}>{v || <Empty />}</li>)}
        </ol>
      )
    case 'math':
      return (
        <div>
          <LatexBlock latex={value} />
          <p className="mt-1 font-mono text-[11px] text-slate-400">{value}</p>
        </div>
      )
    case 'matrix':
      return <Matrix cells={value} />
    case 'matching':
      return (
        <ul className="space-y-0.5">
          {Object.entries(value).map(([p, a]) => <li key={p}><span className="font-medium">{p}</span> → {a || <Empty />}</li>)}
        </ul>
      )
    case 'ordering':
      return <ol className="list-decimal space-y-0.5 pl-5">{value.map((v) => <li key={v}>{v}</li>)}</ol>
    case 'hotspot': {
      const img = q.media?.[0]
      if (!img) return <span>({(value.x * 100).toFixed(1)}%, {(value.y * 100).toFixed(1)}%)</span>
      return (
        <div className="relative inline-block max-w-full">
          <img src={api.mediaUrl(img.url)} alt="Hotspot" className="block max-h-72 max-w-full rounded" />
          {(k.regions || []).map((r, i) => (
            <div key={i} className="absolute border-2 border-emerald-500 bg-emerald-400/20" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
          ))}
          <MapPin className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-full fill-rose-500 text-white" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }} />
        </div>
      )
    }
    case 'file_upload':
      return (
        <div className="space-y-2">
          {value.map((f) =>
            f.kind === 'image' ? (
              <a key={f.url} href={api.mediaUrl(f.url)} target="_blank" rel="noreferrer" className="block">
                <img src={api.mediaUrl(f.url)} alt={f.name} className="max-h-72 max-w-full rounded border border-slate-200 dark:border-slate-700" />
                <span className="text-[11px] text-brand-600">{f.name}</span>
              </a>
            ) : (
              <a key={f.url} href={api.mediaUrl(f.url)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-brand-600 hover:underline">
                <FileText className="h-4 w-4" /> {f.name}
              </a>
            ),
          )}
        </div>
      )
    default:
      return <MathText text={String(value)} />
  }
}

function AnswerKey({ q }) {
  const k = q.answer_key || {}
  const s = q.settings || {}
  let content = null
  switch (q.type) {
    case 'mcq':
    case 'tf':
      content = <MathText text={q.correct_answer || ''} />
      break
    case 'multi':
      content = <MathText text={(k.answers || []).join(', ')} />
      break
    case 'fill_blank':
      content = <ol className="list-decimal pl-5">{(k.blanks || []).map((b, i) => <li key={i}>{b.join(' | ')}</li>)}</ol>
      break
    case 'dropdown':
      content = <ol className="list-decimal pl-5">{(k.answers || []).map((a, i) => <li key={i}>{a}</li>)}</ol>
      break
    case 'numeric':
      content = k.mode === 'range' ? `${k.min} to ${k.max} ${s.unit || ''}` : `${k.value} ± ${k.tolerance || 0} ${s.unit || ''}`
      break
    case 'math':
      content = k.answers?.length ? (
        <div className="space-y-1">{k.answers.map((a, i) => <LatexBlock key={i} latex={a} />)}</div>
      ) : null
      break
    case 'matrix':
      content = k.cells?.length ? <Matrix cells={k.cells} /> : null
      break
    case 'matching':
      content = <ul>{(k.pairs || []).map((p) => <li key={p.prompt}><span className="font-medium">{p.prompt}</span> → {p.answer}</li>)}</ul>
      break
    case 'ordering':
      content = <ol className="list-decimal pl-5">{(k.order || []).map((v) => <li key={v}>{v}</li>)}</ol>
      break
    case 'hotspot':
      content = `${(k.regions || []).length} correct region(s), shown in green`
      break
    default:
      content = null
  }
  if (!content) return null
  return (
    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide">Answer key</p>
      {content}
    </div>
  )
}

export default function ResponseView({ question, response }) {
  if (usesUnifiedEditor(question.type)) {
    return <AnswerDocumentView response={response} />
  }
  const value = parseResponse(question.type, response)
  return (
    <div>
      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        <StudentAnswer q={question} value={value} />
      </div>
      <AnswerKey q={question} />
    </div>
  )
}