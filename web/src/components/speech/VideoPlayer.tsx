import { useEffect, useRef } from 'react'
import 'video.js/dist/video-js.css'
import { createVideoJsPlayer } from '@/shared/media/videojs-adapter'

/**
 * Behind `shared/media/videojs-adapter.ts` per STEP-03-upload-and-watch.md
 * — this component owns only the DOM node and the React lifecycle; the
 * refresh-on-403 handling lives in the adapter so it's testable without a
 * real video.js instance.
 *
 * Follows video.js's own documented React integration pattern rather than
 * rendering a `<video>` tag directly and handing its ref to `videojs()`:
 * a container `<div ref>` is rendered, and a brand-new `<video>` element is
 * created and appended inside the effect on every run. That's not
 * stylistic — reusing one React-rendered `<video>` node across create/
 * dispose/recreate is a real, observed bug: under `<StrictMode>` (dev
 * only), React mounts→cleans up→remounts every effect once, and video.js's
 * `dispose()` doesn't leave that exact node synchronously ready for a
 * second `videojs()` call on it (`WARN: The element supplied is not
 * included in the DOM`), producing a genuinely blank, non-functional
 * player rather than just a console warning. A fresh element every time
 * sidesteps the reuse race entirely — StrictMode's extra cycle just
 * produces a second, independently valid player on a second, independently
 * valid element.
 */
export function VideoPlayer({
  initialUrl,
  refreshUrl,
}: {
  initialUrl: string
  refreshUrl: () => Promise<string>
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Read the latest `refreshUrl` from inside the effect without making it
  // a dependency — the caller's `refreshUrl` closure identity can change on
  // every re-render (it closes over fetched `speech`/`asset` data), and
  // depending on it would tear down and recreate the whole player any time
  // that data refetches, not just when the video itself changes.
  const refreshUrlRef = useRef(refreshUrl)
  useEffect(() => {
    refreshUrlRef.current = refreshUrl
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const videoEl = document.createElement('video')
    videoEl.className = 'video-js vjs-big-play-centered'
    videoEl.setAttribute('playsinline', 'true')
    container.appendChild(videoEl)

    const player = createVideoJsPlayer(videoEl, {
      initialUrl,
      refreshUrl: () => refreshUrlRef.current(),
    })

    return () => {
      player.dispose()
    }
  }, [initialUrl])

  return (
    <div data-vjs-player>
      <div ref={containerRef} />
    </div>
  )
}
