import { useEffect, useState } from 'react'

// Whether this computer exposes at least one camera to the browser.
// Browsers list video inputs (with blank labels) even before permission is
// granted, so this works before the student clicks "Allow Camera".
// Returns true / false, or null while still unknown (or if the browser can't
// tell us — in which case callers should behave as if a camera exists).
export async function detectVideoInputs() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return null
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'videoinput').length
  } catch {
    return null
  }
}

export function useCameraAvailability() {
  const [count, setCount] = useState(null)

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const n = await detectVideoInputs()
      if (!cancelled) setCount(n)
    }
    refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh)
    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh)
    }
  }, [])

  return { count, hasCamera: count === null ? null : count > 0 }
}
