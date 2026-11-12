import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Smartphone, Loader2, CheckCircle2, AlertTriangle, X, Unplug } from 'lucide-react'
import Button from '../common/Button'
import { useProctorSession } from '../../context/ProctorSessionContext'
import { isLocalhostUrl } from '../../services/phoneCamera'
import { API_URL } from '../../services/api'

// "Use your phone as the camera": shows a QR code the student scans with any
// phone (no app install). `onConnected` fires once the phone's video arrives.
export default function PhoneCameraPanel({ attemptId, onConnected, defaultOpen = false, compact = false, required = false }) {
  const { phoneState, phoneStream, startPhoneCamera, stopPhoneCamera } = useProctorSession()
  const [open, setOpen] = useState(required || defaultOpen || phoneState === 'connected')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [pairUrl, setPairUrl] = useState(null)
  const [qr, setQr] = useState(null)

  const connected = phoneState === 'connected' && !!phoneStream

  useEffect(() => {
    if (connected) onConnected?.(phoneStream)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, phoneStream])

  useEffect(() => {
    if (!pairUrl) { setQr(null); return }
    let cancelled = false
    QRCode.toDataURL(pairUrl, { width: 240, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setQr(url) })
      .catch(() => { if (!cancelled) setError('Could not generate the QR code.') })
    return () => { cancelled = true }
  }, [pairUrl])

  const begin = async () => {
    setOpen(true)
    setStarting(true)
    setError(null)
    try {
      setPairUrl(await startPhoneCamera(attemptId))
    } catch (e) {
      setError(e?.message || 'Could not start phone pairing.')
    } finally {
      setStarting(false)
    }
  }

  const cancel = () => {
    stopPhoneCamera()
    setPairUrl(null)
    setQr(null)
    setOpen(required)
    setError(null)
  }

  // After a disconnect (or a lost phone) a webcam-less computer goes straight
  // back to a fresh QR code instead of an empty panel.
  useEffect(() => {
    if (required && open && !pairUrl && !starting && !error && phoneState === 'idle') begin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, open, pairUrl, phoneState])

  const unreachable = pairUrl && (isLocalhostUrl(pairUrl) || isLocalhostUrl(API_URL))
  const insecure = pairUrl && !window.isSecureContext && !isLocalhostUrl(pairUrl)

  if (!open) {
    return (
      <div className={compact ? '' : 'mt-4 border-t border-slate-100 pt-4 dark:border-slate-800'}>
        <Button className="w-full" variant="outline" icon={Smartphone} onClick={begin}>
          {required ? 'Use your phone as the camera' : 'No webcam? Use your phone as the camera'}
        </Button>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50 ${compact ? '' : 'mt-4'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Smartphone className="h-4 w-4 text-brand-600" /> Use your phone as the camera
        </div>
        {!connected && !required && (
          <button onClick={cancel} aria-label="Cancel phone pairing" className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {connected ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Phone camera connected
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Keep the phone propped up with its screen on and the page open for the whole exam.
          </p>
          <Button className="w-full" variant="danger" icon={Unplug} onClick={cancel}>Disconnect phone</Button>
        </div>
      ) : (
        <div className="mt-3">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-300">
            <li>Open your phone's camera app (or any QR scanner).</li>
            <li>Point it at the code below and tap the link.</li>
            <li>Tap <strong>Start camera</strong> and allow camera access.</li>
          </ol>

          <div className="mt-3 flex flex-col items-center gap-2">
            {starting && <Loader2 className="h-6 w-6 animate-spin text-slate-400" />}
            {qr && <img src={qr} alt="QR code to connect your phone camera" className="h-48 w-48 rounded-lg bg-white p-2" />}
            {qr && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                {phoneState === 'connecting' ? 'Phone found, linking…' : 'Waiting for your phone…'}
              </p>
            )}
          </div>

          {unreachable && (
            <p className="mt-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              This link points to "localhost", which your phone can't reach. Open the app on this computer using its
              network address (and set VITE_API_URL to the server's network address), then try again.
            </p>
          )}
          {insecure && (
            <p className="mt-3 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Phone browsers only allow camera access on HTTPS pages. Serve the app over HTTPS for phone pairing to work.
            </p>
          )}
          {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
          {(error || (!starting && !pairUrl)) && (
            <Button className="mt-2" size="sm" variant="outline" onClick={begin}>Try again</Button>
          )}
        </div>
      )}
    </div>
  )
}
