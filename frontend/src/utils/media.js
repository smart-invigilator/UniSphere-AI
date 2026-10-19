export function captureFrame(videoEl, quality = 0.7) {
  if (!videoEl || !videoEl.videoWidth) return null
  const canvas = document.createElement('canvas')
  canvas.width = videoEl.videoWidth
  canvas.height = videoEl.videoHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}
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
export function captureFromStream(stream, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!stream) return reject(new Error('No stream'))
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.onloadedmetadata = () => {
      video.play().then(() => {
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