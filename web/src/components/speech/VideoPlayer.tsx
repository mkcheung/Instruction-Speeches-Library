import { useEffect, useRef } from 'react'
import 'video.js/dist/video-js.css'
import { createVideoJsPlayer } from '@/shared/media/videojs-adapter'

/**
 * Behind `shared/media/videojs-adapter.ts` per STEP-03-upload-and-watch.md
 * — this component owns only the DOM node and the React lifecycle; the
 * refresh-on-403 handling lives in the adapter so it's testable without a
 * real video.js instance.
 */
export function VideoPlayer({
  initialUrl,
  refreshUrl,
}: {
  initialUrl: string
  refreshUrl: () => Promise<string>
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    const player = createVideoJsPlayer(el, { initialUrl, refreshUrl })

    return () => player.dispose()
    // Intentionally re-created only if the initial URL identity changes
    // (i.e. a different asset) — refreshUrl handles TTL expiry in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl])

  return (
    <div data-vjs-player>
      <video ref={videoRef} className="video-js vjs-big-play-centered" playsInline />
    </div>
  )
}
