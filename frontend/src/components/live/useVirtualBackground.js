import { useCallback, useEffect, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import { BackgroundProcessor, supportsBackgroundProcessors } from '@livekit/track-processors'
import { BACKGROUND_STORAGE_KEY, rasterizeBackground } from './liveBackgrounds'

const ASSET_PATHS = {
  tasksVisionFileSet: '/mediapipe/wasm',
  modelAssetPath: '/mediapipe/selfie_segmenter.tflite',
}

const readSaved = () => {
  try {
    return localStorage.getItem(BACKGROUND_STORAGE_KEY) || 'none'
  } catch {
    return 'none'
  }
}

// Keeps the local camera's background effect (none / blur / image) in sync with the
// chosen option, re-applying it whenever the camera track is recreated (camera toggled).
export function useVirtualBackground(room, camOn, pushNotice) {
  const [choice, setChoice] = useState(readSaved)
  const [busy, setBusy] = useState(false)
  const processorRef = useRef(null)
  const trackRef = useRef(null)
  const supported = typeof window !== 'undefined' && supportsBackgroundProcessors()

  const select = useCallback((id) => {
    setChoice(id)
    try {
      localStorage.setItem(BACKGROUND_STORAGE_KEY, id)
    } catch {
      // Preference just won't persist.
    }
  }, [])

  useEffect(() => {
    if (!room || !camOn) return undefined
    const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack
    if (!track) return undefined
    let cancelled = false

    const apply = async () => {
      // A new camera track starts without a processor.
      if (trackRef.current !== track) {
        processorRef.current = null
        trackRef.current = track
      }
      try {
        if (choice === 'none') {
          if (processorRef.current) {
            await track.stopProcessor()
            processorRef.current = null
          }
          return
        }
        if (!supported) {
          pushNotice?.('Background effects are not supported in this browser.', 'warning')
          select('none')
          return
        }
        setBusy(true)
        const options = choice === 'blur'
          ? { mode: 'background-blur', blurRadius: 14 }
          : { mode: 'virtual-background', imagePath: await rasterizeBackground(choice) }
        if (cancelled) return
        if (processorRef.current) {
          await processorRef.current.switchTo(options)
        } else {
          const processor = BackgroundProcessor({ ...options, assetPaths: ASSET_PATHS })
          processorRef.current = processor
          await track.setProcessor(processor)
        }
      } catch (err) {
        processorRef.current = null
        pushNotice?.('Could not apply the background effect. Your camera is unchanged.', 'error')
        select('none')
        console.error('[live] background effect failed', err)
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    apply()
    return () => {
      cancelled = true
    }
  }, [room, camOn, choice, supported, pushNotice, select])

  return { choice, select, busy, supported }
}
