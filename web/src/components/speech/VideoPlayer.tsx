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
  poster,
  onPlayerReady,
  onSourceRefreshed,
}: {
  initialUrl: string
  refreshUrl: () => Promise<string>
  /** STEP-04 §9.5: the speech's real poster URL, if one exists yet — wired
   * straight into video.js's own `poster` option. */
  poster?: string
  /** Hands the caller the underlying video.js player instance once created
   * (e.g. so `SpeechWatch` can read `currentTime()` for "use current
   * frame") — never re-created for the same mounted player. */
  onPlayerReady?: (player: ReturnType<typeof createVideoJsPlayer>) => void
  /** §9.3/videojs-adapter's `onSourceRefreshed`: fires once an
   * error-driven URL refresh has actually reloaded — video.js strips
   * remote text tracks (captions) on every `src` reassignment, so the
   * caller needs this to know when to re-attach the caption track. */
  onSourceRefreshed?: () => void
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

  const onPlayerReadyRef = useRef(onPlayerReady)
  useEffect(() => {
    onPlayerReadyRef.current = onPlayerReady
  })

  const onSourceRefreshedRef = useRef(onSourceRefreshed)
  useEffect(() => {
    onSourceRefreshedRef.current = onSourceRefreshed
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const videoEl = document.createElement('video')
    videoEl.className = 'video-js vjs-big-play-centered'
    videoEl.setAttribute('playsinline', 'true')
    // STEP-09-VERIFICATION-PLAN.md §5: a stable seam for Playwright to grab
    // the real `HTMLVideoElement` (native `textTracks`, `currentTime`, etc.)
    // without depending on video.js's own generated DOM structure.
    videoEl.setAttribute('data-testid', 'speech-video')
    container.appendChild(videoEl)

    const player = createVideoJsPlayer(videoEl, {
      initialUrl,
      refreshUrl: () => refreshUrlRef.current(),
      poster,
      onSourceRefreshed: () => onSourceRefreshedRef.current?.(),
    })

    // video.js copies the original <video> tag's attributes (including the
    // data-testid set above) onto the wrapper <div> it builds around that
    // same element, while `videoEl` itself remains underneath as the real
    // tech <video> — so both DOM nodes end up with data-testid="speech-video",
    // a Playwright strict-mode violation (STEP-09-VERIFICATION-PLAN.md §5
    // asks for it "on the real video", not this wrapper). Strip it from the
    // wrapper only; `videoEl` keeps its own copy untouched.
    player.el().removeAttribute('data-testid')

    // `player.tech()` (what `getVideoElement` reads) is not guaranteed
    // attached synchronously right after `videojs()` returns — video.js's
    // own documented contract is that anything tech-dependent waits for
    // `player.ready()`. Calling the callback synchronously here left
    // `videoEl` stuck `null` for STEP-06's annotation engine (and anything
    // else downstream of `onPlayerReady`), since it's never retried.
    player.ready(() => {
      onPlayerReadyRef.current?.(player)
    })

    return () => {
      player.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl])

  return (
    // W2: `fill: true` needs a height chain, and `height: 100%` on these
    // two divs is the WRONG way to give it one — `[data-vjs-player] > div`
    // is `video.js`'s own inner div where the player root gets built, and
    // percentage height against an auto-height parent collapses to 0.
    // WORSE: WebKit specifically does not treat an `aspect-ratio`-derived
    // height as "definite" for percentage resolution even when the outer
    // box does have one (measured 349x0 in WebKit vs 349x620 elsewhere).
    // Absolute positioning sidesteps percentage-height resolution
    // altogether — the parent (`SpeechWatch.tsx`'s `.relative` wrapper)
    // already establishes the positioning context.
    <div data-vjs-player className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  )
}
