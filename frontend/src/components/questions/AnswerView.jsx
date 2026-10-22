import MathText from '../math/MathText'
import QuestionRenderer from './QuestionRenderer'
import HotspotPicker from './HotspotPicker'
import QuestionImage from './QuestionImage'
import { parseResponse, isManualType } from '../../utils/questionTypes'
export default function AnswerView({ question, response, showKey = true }) {
  const value = parseResponse(question, response)
  const empty = value === undefined || value === ''
  const key = question.answer_key

  if (isManualType(question.type)) {
    return (
      <div className="space-y-2">
        {question.image_url && <QuestionImage src={question.image_url} alt={question.config?.image_alt} />}
        <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {empty ? <span className="italic text-slate-400">No answer submitted</span> : <MathText text={String(value)} />}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Student answer</p>
        {empty && question.type !== 'hotspot' ? <span className="text-sm italic text-slate-400">No answer submitted</span> : (
          question.type === 'hotspot'
            ? <HotspotPicker src={question.image_url} alt={question.config?.image_alt} point={value} regions={showKey ? key?.regions : undefined} />
            : <QuestionRenderer q={question} value={value} readOnly />
        )}
      </div>
      {showKey && <CorrectAnswer question={question} />}
    </div>
  )
}

function CorrectAnswer({ question: q }) {
  const key = q.answer_key
  let text = null
  switch (q.type) {
    case 'mcq': case 'tf': text = q.correct_answer; break
    case 'msq': text = (key?.correct || []).join('  ·  '); break
    case 'fill_blank': text = (key?.blanks || []).map((b, i) => `[${i + 1}] ${b.answers.join(' / ')}`).join('   '); break
    case 'numeric': text = `${key?.value}${q.config?.unit ? ' ' + q.config.unit : ''}  (±${key?.tolerance}${key?.tolerance_type === 'percent' ? '%' : ''})`; break
    case 'math_expr': text = key?.expression; break
    case 'matrix': text = (key?.matrix || []).map((r) => `[ ${r.join('  ')} ]`).join('   '); break
    case 'matching': {
      const l = Object.fromEntries((q.config?.left || []).map((x) => [x.id, x.text]))
      const r = Object.fromEntries((q.config?.right || []).map((x) => [x.id, x.text]))
      text = Object.entries(key?.pairs || {}).map(([a, b]) => `${l[a]} → ${r[b]}`).join('   ·   '); break
    }
    case 'ordering': text = (q.config?.items || []).map((i, n) => `${n + 1}. ${i.text}`).join('   '); break
    case 'hotspot': text = 'Correct area is outlined in green on the picture'; break
    default: return null
  }
  return (
    <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">Correct answer</p>
      <MathText text={String(text ?? '')} />
    </div>
  )
}
