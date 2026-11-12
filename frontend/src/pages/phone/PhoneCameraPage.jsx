import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Camera, CheckCircle2, Loader2, RefreshCw, Smartphone, WifiOff } from 'lucide-react'
import { PhoneCameraClient } from '../../services/phoneCamera'

function cameraErrorMessage(e) {
  if (e?.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access for this page in your browser settings, then try again.'
  if (e?.name === 'NotFoundError') return 'No camera was found on this phone.'
  if (e?.name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.'
  return e?.message || 'Could not open the camera.'
}

// Opened on the student's phone after scanning the QR code shown on the exam
// page. No login or app install: the pairing token in the URL is the credential.
export default function PhoneCameraPage() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const apiUrl = params.get('api') || undefined

  const clientRef = useRef(null)
  const videoRef = useRef(null)
  const wakeLockRef = useRef(null)
  // idle -> starting -> live (camera on, linked to the exam) | ended
  const [phase, setPhase] = useState('idle')
  const [link, setLink] = useState('new')      // new | connecting | connected | dropped
  const [error, setError] = useState(null)
  const [endedReason, setEndedReason] = useState(null)
  const [facing, setFacing] = useState('user')

  useEffect(() => () => {
    clientRef.current?.close()
    wakeLockRef.current?.release?.().catch(() => {})
  }, [])

  const keepAwake = async () => {
    try {
      wakeLockRef.current = await navigator.wakeLock?.request('screen')
    } catch { /* unsupported or denied: the on-screen tip still applies */ }
  }

  // Wake locks are released when the tab is hidden; take it back on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && phase === 'live') keepAwake()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [phase])

  const start = async () => {
    setError(null)
    setPhase('starting')
    const client = new PhoneCameraClient(token, apiUrl)
    clientRef.current = client
    client.on('local', (stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play?.().catch(() => {})
      }
    })
    client.on('connection', (state) => {
      if (state === 'connected') setLink('connected')
      else if (state === 'connecting' || state === 'new') setLink('connecting')
      else setLink('dropped')
    })
    client.on('disconnected', () => setLink('dropped'))
    client.on('host-left', () => { setEndedReason('The exam page on your computer was closed.'); setPhase('ended'); client.close() })
    client.on('replaced', () => { setEndedReason('Another phone was paired to this exam.'); setPhase('ended'); client.close() })
    try {
      await client.openCamera(facing)
      setLink('connecting')
      await client.connect()
      setPhase('live')
      keepAwake()
    } catch (e) {
      client.close()
      clientRef.current = null
      setPhase('idle')
      setError(e?.name ? cameraErrorMessage(e) : e.message)
    }
  }

  const flip = async () => {
    const next = facing === 'user' ? 'environment' : 'user'
    try {
      await clientRef.current?.openCamera(next)
      setFacing(next)
    } catch (e) {
      setError(cameraErrorMessage(e))
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Smartphone size={16} /> Phone camera for your exam
        </div>

        {phase === 'ended' ? (
          <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
            <WifiOff className="mx-auto text-slate-400" size={32} />
            <p className="mt-3 text-base font-semibold">Camera disconnected</p>
            <p className="mt-1 text-sm text-slate-400">{endedReason} You can close this page.</p>
          </div>
        ) : (
          <>
            <div className="relative mt-4 aspect-[3/4] w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`}
              />
              {phase === 'idle' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-slate-400">
                  <Camera size={36} />
                  <p className="text-sm">Your camera preview will appear here.</p>
                </div>
              )}
            </div>

            {phase === 'live' && (
              <div className={`mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
                link === 'connected' ? 'bg-emerald-500/15 text-emerald-300'
                  : link === 'dropped' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}
              >
                {link === 'connected' && <><CheckCircle2 size={16} /> Connected to your exam</>}
                {link === 'connecting' && <><Loader2 size={16} className="animate-spin" /> Linking to your computer…</>}
                {link === 'dropped' && <><WifiOff size={16} /> Connection lost. Reconnecting — keep this page open.</>}
              </div>
            )}

            {error && <p className="mt-4 rounded-xl bg-rose-500/15 px-4 py-3 text-sm text-rose-300">{error}</p>}

            {phase !== 'live' ? (
              <button
                onClick={start}
                disabled={phase === 'starting'}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3.5 text-base font-semibold text-white disabled:opacity-60"
              >
                {phase === 'starting' ? <><Loader2 size={18} className="animate-spin" /> Starting…</> : <><Camera size={18} /> Start camera</>}
              </button>
            ) : (
              <button
                onClick={flip}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-slate-200"
              >
                <RefreshCw size={16} /> Switch front / back camera
              </button>
            )}

            <ul className="mt-6 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-slate-400">
              <li>Prop your phone up so your face and desk are in view.</li>
              <li>Keep this page open and the screen on until the exam ends.</li>
              <li>Plug in your charger if you can; closing this page counts as a camera violation.</li>
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
