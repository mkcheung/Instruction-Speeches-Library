import { useEffect, useState } from 'react'

/**
 * Coarse, React-state `currentTime` for UI that doesn't need the
 * microsecond precision `useTimedAnnotations` has — `OverlayStack`'s
 * `[t-12s, t+12s]` render window and `Transcript`'s "nearest cue" fallback
 * both only need to be roughly right, so a plain `timeupdate` listener
 * (the browser's own 4-66Hz cadence) is enough; this deliberately does
 * NOT reuse the engine's rvfc/reconciler machinery; that machinery is
 * expensive precision purpose-built for cue activation, not general
 * "what second are we roughly at" UI state.
 */
export function useVideoCurrentTime(videoEl: HTMLVideoElement | null): number {
  const [time, setTime] = useState(0)

  useEffect(() => {
    if (!videoEl) {
      const reset = () => setTime(0)
      reset()
      return
    }
    const update = () => setTime(videoEl.currentTime)
    update()
    videoEl.addEventListener('timeupdate', update)
    videoEl.addEventListener('seeked', update)
    videoEl.addEventListener('loadedmetadata', update)
    return () => {
      videoEl.removeEventListener('timeupdate', update)
      videoEl.removeEventListener('seeked', update)
      videoEl.removeEventListener('loadedmetadata', update)
    }
  }, [videoEl])

  return time
}
