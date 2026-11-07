import { Ban, Droplets, Loader2, Check } from 'lucide-react'
import Modal from '../common/Modal'
import { BACKGROUNDS, svgToDataUrl } from './liveBackgrounds'

function Option({ selected, onClick, label, children, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      data-testid={testId}
      className={`group relative aspect-video overflow-hidden rounded-lg border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        selected ? 'border-brand-600' : 'border-slate-200 hover:border-brand-400 dark:border-slate-700'
      }`}
    >
      {children}
      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 text-left text-[10px] font-medium text-white">{label}</span>
      {selected && (
        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  )
}

export default function BackgroundPicker({ open, onClose, choice, onSelect, busy, supported, cameraOn }) {
  return (
    <Modal open={open} onClose={onClose} title="Background effects" maxWidth="max-w-2xl">
      <div className="space-y-3">
        {!supported && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            Your browser doesn't support background effects. Try a recent version of Chrome or Edge.
          </p>
        )}
        {supported && !cameraOn && (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Turn your camera on to see the effect. Your choice is saved and applied automatically.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Choose a background">
          <Option label="No effect" selected={choice === 'none'} onClick={() => onSelect('none')} testId="bg-none">
            <span className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-500 dark:bg-slate-800"><Ban className="h-6 w-6" /></span>
          </Option>
          <Option label="Blur" selected={choice === 'blur'} onClick={() => onSelect('blur')} testId="bg-blur">
            <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-300 to-slate-100 text-slate-600 dark:from-slate-700 dark:to-slate-600"><Droplets className="h-6 w-6" /></span>
          </Option>
          {BACKGROUNDS.map((b) => (
            <Option key={b.id} label={b.label} selected={choice === b.id} onClick={() => onSelect(b.id)} testId={`bg-${b.id}`}>
              <img src={b.imagePath || svgToDataUrl(b.svg)} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />
            </Option>
          ))}
        </div>
        {busy && (
          <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying background…
          </p>
        )}
      </div>
    </Modal>
  )
}
