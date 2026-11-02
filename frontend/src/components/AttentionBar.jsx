import { attentionBand } from '../utils/format'
const BAR = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500' }
export default function AttentionBar({ score, showLabel = true }) {
  const band = attentionBand(score)
  return (
    <div>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-slate-500 dark:text-slate-400">Attention</span>
          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{score}%</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className={`h-full rounded-full transition-all duration-500 ${BAR[band.color]}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}
