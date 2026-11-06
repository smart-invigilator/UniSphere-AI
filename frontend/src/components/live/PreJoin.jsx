import { useEffect, useRef, useState } from 'react'
import { Room } from 'livekit-client'
import { Mic, MicOff, Video, VideoOff, Loader2, Radio, ChevronDown } from 'lucide-react'
import Button from '../common/Button'
import { mediaErrorMessage } from './liveUtils'

export function DeviceSelect({ kind, label, value, onChange, devices }) {
  const selectId = `device-${kind}`
  return (
    <div className="block text-xs">
      <label htmlFor={selectId} className="mb-1 block font-semibold text-slate-600 dark:text-slate-300">{label}</label>
      <div className="relative">
        <select
          id={selectId}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full cursor-pointer appearance-none truncate rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          data-kind={kind}
        >
          {devices.length === 0 && <option value="">Default</option>}
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId} className="bg-white text-slate-900 dark:bg-slate-800 dark:text-white">
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
      </div>
    </div>
  )
}

export default function PreJoin({ liveClass, role, onJoin, joining, error }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [mic, setMic] = useState(true)
  const [camera, setCamera] = useState(true)
  const [devices, setDevices] = useState({ audioinput: [], videoinput: [] })
  const [chosen, setChosen] = useState({ audioinput: '', videoinput: '' })
  const [previewError, setPreviewError] = useState(null)
  const notStarted = liveClass.status === 'scheduled'

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (!camera && !mic) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: camera ? (chosen.videoinput ? { deviceId: { exact: chosen.videoinput } } : true) : false,
          audio: mic ? (chosen.audioinput ? { deviceId: { exact: chosen.audioinput } } : true) : false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = camera ? stream : null
        setPreviewError(null)
        const [a, v] = await Promise.all([Room.getLocalDevices('audioinput'), Room.getLocalDevices('videoinput')])
        if (!cancelled) setDevices({ audioinput: a, videoinput: v })
      } catch (err) {
        if (!cancelled) setPreviewError(mediaErrorMessage(err, camera ? 'camera or microphone' : 'microphone'))
      }
    }
    start()
    return () => {
      cancelled = true
    }
  }, [camera, mic, chosen.audioinput, chosen.videoinput])

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  const join = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    onJoin({ mic, camera, devices: chosen })
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 p-4 md:grid-cols-[1.4fr_1fr] md:p-8" data-testid="prejoin">
      <div>
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-800">
          {camera ? (
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Camera is off</div>
          )}
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
            <button type="button" onClick={() => setMic(!mic)} aria-pressed={mic} aria-label={mic ? 'Turn microphone off' : 'Turn microphone on'} className={`rounded-full p-3 ${mic ? 'bg-white/20 text-white' : 'bg-rose-600 text-white'}`}>
              {mic ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <button type="button" onClick={() => setCamera(!camera)} aria-pressed={camera} aria-label={camera ? 'Turn camera off' : 'Turn camera on'} className={`rounded-full p-3 ${camera ? 'bg-white/20 text-white' : 'bg-rose-600 text-white'}`}>
              {camera ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {previewError && <p className="mt-2 text-xs font-medium text-amber-600">{previewError} You can still join and turn it on later.</p>}
      </div>
      <div className="flex flex-col justify-center gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{liveClass.course_title}</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{liveClass.title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">with {liveClass.teacher_name}</p>
        </div>
        <DeviceSelect kind="audioinput" label="Microphone" value={chosen.audioinput} devices={devices.audioinput} onChange={(v) => setChosen((c) => ({ ...c, audioinput: v }))} />
        <DeviceSelect kind="videoinput" label="Camera" value={chosen.videoinput} devices={devices.videoinput} onChange={(v) => setChosen((c) => ({ ...c, videoinput: v }))} />
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" role="alert">{error}</p>}
        {notStarted && role !== 'teacher' ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            The teacher hasn't started this class yet. This page will let you in as soon as it starts.
          </p>
        ) : (
          <Button size="lg" icon={joining ? Loader2 : Radio} disabled={joining} onClick={join} data-testid="join-button">
            {joining ? 'Joining…' : notStarted ? 'Start class & join' : 'Join now'}
          </Button>
        )}
      </div>
    </div>
  )
}