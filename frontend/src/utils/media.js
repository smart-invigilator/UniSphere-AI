const captureCanvases = new WeakMap()

export function captureFrame(videoEl, quality = 0.7, maxWidth = 0) {
  if (!videoEl || !videoEl.videoWidth) return null
  let canvas = captureCanvases.get(videoEl)
  if (!canvas) {
    canvas = document.createElement('canvas')
    captureCanvases.set(videoEl, canvas)
  }
  const scale = maxWidth > 0 && videoEl.videoWidth > maxWidth ? maxWidth / videoEl.videoWidth : 1
  const width = Math.round(videoEl.videoWidth * scale)
  const height = Math.round(videoEl.videoHeight * scale)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(videoEl, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', quality)
}

// Waits until a <video> element actually has a decoded frame ready to draw
// (readyState >= 2 / HAVE_CURRENT_DATA and a real videoWidth), instead of
// guessing with a fixed sleep duration. Webcam startup latency varies a lot
// by device/driver, so a fixed delay is inherently unreliable — this
// resolves as soon as the video is genuinely ready, or after `timeoutMs` as
// a fallback so callers never hang forever. Also explicitly calls play():
// the `autoplay` HTML attribute isn't always honored reliably when
// `srcObject` is assigned dynamically via JS in every browser.
export function waitForVideoReady(videoEl, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!videoEl) return resolve(false)

    const isReady = () => videoEl.readyState >= 2 && videoEl.videoWidth > 0
    if (isReady()) return resolve(true)

    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      videoEl.removeEventListener('loadeddata', onEvent)
      videoEl.removeEventListener('canplay', onEvent)
      videoEl.removeEventListener('playing', onEvent)
      clearTimeout(timer)
      resolve(ok)
    }
    const onEvent = () => {
      if (isReady()) finish(true)
    }

    videoEl.addEventListener('loadeddata', onEvent)
    videoEl.addEventListener('canplay', onEvent)
    videoEl.addEventListener('playing', onEvent)
    videoEl.play?.().catch(() => {})

    const timer = setTimeout(() => finish(isReady()), timeoutMs)
  })
}

// Capture a frame directly from a live MediaStream without needing a
// mounted <video> element (used for one-shot captures during the checklist).
export function captureFromStream(stream, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!stream) return reject(new Error('No stream'))
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.onloadedmetadata = () => {
      video.play().then(() => {
        // let a frame or two render
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const frame = captureFrame(video, quality)
            resolve(frame)
          })
        })
      }).catch(reject)
    }
    video.onerror = reject
  })
}

export function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop())
}
export class ScreenShareError extends Error {}

export async function requestEntireScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new ScreenShareError('Screen sharing is not supported in this browser. Please use the latest Chrome or Edge.')
  }
  const options = {
    video: { displaySurface: 'monitor' },
    audio: false,
    monitorTypeSurfaces: 'include',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
    preferCurrentTab: false,
  }
  let controller = null
  if (typeof window !== 'undefined' && typeof window.CaptureController === 'function') {
    controller = new window.CaptureController()
    options.controller = controller
  }
  const stream = await navigator.mediaDevices.getDisplayMedia(options)
  if (controller && typeof controller.setFocusBehavior === 'function') {
    try {
      controller.setFocusBehavior('no-focus-change')
    } catch {
      controller = null
    }
  }
  const track = stream.getVideoTracks()[0]
  const displaySurface = track?.getSettings?.().displaySurface
  if (displaySurface && displaySurface !== 'monitor') {
    stream.getTracks().forEach((t) => t.stop())
    throw new ScreenShareError('Please share your ENTIRE SCREEN, not a single window or tab. Click "Share Screen" again and choose your whole monitor.')
  }
  return stream
}