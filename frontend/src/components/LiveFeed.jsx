import { useEffect, useRef } from 'react'
import { Video, Monitor, WifiOff } from 'lucide-react'
export default function LiveFeed({ type = 'face', seed = 'x', connected = true, size = 'sm', stream = null, mirror = false }) {
  const canvasRef = useRef(null)
  const videoRef = useRef(null)

  useEffect(() => {
    if (!stream || !videoRef.current) return
    videoRef.current.srcObject = stream
    const p = videoRef.current.play()
    if (p?.catch) p.catch(() => {})
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [stream])

  useEffect(() => {
    if (stream) return 
    if (!connected) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf
    let t = Math.abs(hash(seed)) % 1000

    const draw = () => {
      const { width: w, height: h } = canvas
      const base = type === 'face' ? '#1e293b' : '#0f172a'
      ctx.fillStyle = base
      ctx.fillRect(0, 0, w, h)

      if (type === 'face') {
        const cx = w / 2 + Math.sin(t / 40) * 6
        const cy = h / 2 + Math.cos(t / 55) * 4
        const grd = ctx.createRadialGradient(cx, cy, 8, cx, cy, h * 0.6)
        grd.addColorStop(0, 'rgba(59,130,246,0.35)')
        grd.addColorStop(1, 'rgba(15,23,42,0)')
        ctx.fillStyle = grd
        ctx.fillRect(0, 0, w, h)
        ctx.strokeStyle = 'rgba(96,165,250,0.7)'
        ctx.lineWidth = 1.5
        const bw = w * 0.42, bh = h * 0.55
        ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh)
        ctx.fillStyle = 'rgba(96,165,250,0.9)'
        ctx.beginPath(); ctx.arc(cx - bw * 0.18, cy - bh * 0.1, 2.2, 0, 7); ctx.fill()
        ctx.beginPath(); ctx.arc(cx + bw * 0.18, cy - bh * 0.1, 2.2, 0, 7); ctx.fill()
      } else {
        ctx.strokeStyle = 'rgba(148,163,184,0.12)'
        for (let i = 0; i < h; i += 14) {
          ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke()
        }
        ctx.fillStyle = 'rgba(59,130,246,0.25)'
        const bx = (t * 1.3) % (w - 40)
        ctx.fillRect(bx, h * 0.3, 36, 10)
        ctx.fillStyle = 'rgba(148,163,184,0.3)'
        ctx.fillRect(10, 10, w * 0.4, 6)
        ctx.fillRect(10, 22, w * 0.6, 6)
      }
      t += 1
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [type, seed, connected, stream])

  const Icon = type === 'face' ? Video : Monitor
  const heights = { sm: 'h-24', md: 'h-32', lg: 'h-72' ,xl:'h-96'}

  if (!connected && !stream) {
    return (
      <div className={`relative ${heights[size]} w-full rounded-lg bg-slate-200 dark:bg-slate-800 flex flex-col items-center justify-center gap-1 text-slate-400`}>
        <WifiOff className="h-5 w-5" />
        <span className="text-[10px] font-medium uppercase tracking-wide">Offline</span>
      </div>
    )
  }

  return (
    <div className={`relative ${heights[size]} w-full overflow-hidden rounded-lg bg-slate-900`}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay muted playsInline
          className="h-full w-full object-cover"
          style={mirror ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <canvas ref={canvasRef} width={320} height={size === 'lg' ? 320 : 140} className="h-full w-full object-cover" />
      )}
      <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-white">Live</span>
      </div>
      <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/40 px-1.5 py-0.5 text-white backdrop-blur">
        <Icon className="h-3 w-3" />
        <span className="text-[9px] font-medium capitalize">{type}</span>
      </div>
    </div>
  )
}

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i)
  return h
}
