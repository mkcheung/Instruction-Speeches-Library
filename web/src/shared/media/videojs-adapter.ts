import videojs from 'video.js'
import type Player from 'video.js/dist/types/player'

/**
 * §9.3: "Treat the refresh handler as an S3 spike, not settled design...
 * An expired URL surfaces inside `<video>` as `MEDIA_ERR_NETWORK` with no
 * HTTP status reachable from JavaScript, and reassigning `src` mid-playback
 * loses position and re-buffers. Prove the handler restores position
 * before committing to a short TTL." This adapter is that proof: on a
 * network/src error, it fetches a fresh presigned URL, reassigns `src`,
 * and seeks back to where playback was — the acceptance item "seeking past
 * the 10-minute TTL refreshes the URL and restores playback position."
 *
 * Only `MEDIA_ERR_NETWORK` (2) and `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) are
 * treated as "possibly an expired URL" — the other two (ABORTED,
 * DECODE) are real playback failures a fresh URL can't fix, and retrying
 * them would loop forever.
 *
 * Numeric literals, not the `MediaError` global's named constants: jsdom
 * (this project's test environment) doesn't implement `MediaError` at all,
 * and the values are part of the stable W3C Media Source spec, not
 * implementation details.
 */
const MEDIA_ERR_NETWORK = 2
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4
const RETRYABLE_ERROR_CODES: Set<number> = new Set([MEDIA_ERR_NETWORK, MEDIA_ERR_SRC_NOT_SUPPORTED])

export interface VideoJsAdapterOptions {
  /** The initial presigned GET URL. */
  initialUrl: string
  /** Called on a retryable error; must resolve to a fresh presigned URL. */
  refreshUrl: () => Promise<string>
  poster?: string
}

export function createVideoJsPlayer(element: HTMLVideoElement, options: VideoJsAdapterOptions): Player {
  const player = videojs(element, {
    controls: true,
    // W1/W2 (PLAN-APP-HEADER.md): `fluid: true` sizes the player by a
    // percentage `padding-top` derived from `videoWidth:videoHeight` and
    // the CONTAINER'S WIDTH — a portrait clip in a 704px column renders
    // 704x1252, and `max-height` cannot fix it (padding is outside the
    // content box it constrains). `fill: true` makes the player stop
    // computing its own height and just fill whatever box it's given —
    // `SpeechWatch.tsx`'s `.relative` wrapper is that box (W2/W3).
    fill: true,
    playsinline: true,
    poster: options.poster,
    sources: [{ src: options.initialUrl, type: 'video/mp4' }],
  })

  // STEP-04-every-video-plays.md §9.5's poster-flash mitigation.
  // Reassigning `player.src(...)` on a URL refresh (below) resets the
  // media element's internal "show poster" state, so — without this — the
  // poster image flashes back over the video mid-playback every time the
  // presigned URL is refreshed. `loadeddata` fires once a frame is
  // actually decoded and ready to paint, so clearing the poster there
  // means the browser has nothing to show once real video content exists;
  // `emptied` fires when `src` is reassigned (both on a genuine new video
  // AND on our own refresh reassignment) and is the only correct moment to
  // put the poster attribute back, since that's when the element has no
  // frame at all again. Both handlers are registered exactly ONCE, here,
  // for the life of this player — via `.on()`, not `.one()` re-armed per
  // cycle — so they naturally fire again on every subsequent refresh
  // without ever being re-registered (no duplicate-listener accumulation
  // the way the error-driven refresh handlers below have to guard against
  // with explicit `.one()`/`.off()` pairs, since those ARE re-added per
  // error).
  if (options.poster) {
    const originalPoster = options.poster
    player.on('loadeddata', () => player.poster(''))
    player.on('emptied', () => player.poster(originalPoster))
  }

  let refreshing = false

  player.on('error', () => {
    const error = player.error()
    if (!error || !RETRYABLE_ERROR_CODES.has(error.code) || refreshing) return

    refreshing = true
    const resumeAt = player.currentTime() ?? 0
    const wasPlaying = !player.paused();

    (async () => {
      try {
        const freshUrl = await options.refreshUrl()

        // Both outcomes of the reassigned `src` must clear `refreshing`,
        // not just the success one — a fresh URL that ALSO errors (e.g.
        // the refresh endpoint itself is failing) would otherwise leave
        // `refreshing` stuck `true` forever, permanently disabling every
        // later retry for this player. `.one()` on each other's event
        // name so only the outcome that actually happens fires.
        const onLoaded = () => {
          player.off('error', onFailedAgain)
          player.currentTime(resumeAt)
          if (wasPlaying) void player.play()?.catch(() => undefined)
          refreshing = false
        }
        const onFailedAgain = () => {
          player.off('loadedmetadata', onLoaded)
          refreshing = false
        }

        player.one('loadedmetadata', onLoaded)
        player.one('error', onFailedAgain)

        player.src({ src: freshUrl, type: 'video/mp4' })
      } catch {
        refreshing = false
      }
    })()
  })

  return player
}

/**
 * STEP-06-watch-commentary.md needs the raw `HTMLMediaElement` to drive
 * `useTimedAnnotations` (VTTCue/TextTrack live on the element, not the
 * video.js `Player` wrapper). Per STEP-03's boundary, this file is "the
 * one file allowed to touch `player.tech()`" — so that call is centralized
 * here, once, rather than every consumer reaching into the player itself.
 * Returns `null` before the player has a tech attached (shouldn't happen
 * post-`createVideoJsPlayer`, but the tech API is officially untyped).
 */
export function getVideoElement(player: Player): HTMLVideoElement | null {
  const tech = player.tech({ IWillNotUseThisInPlugins: true })
  const el = tech?.el() as Element | undefined
  return el instanceof HTMLVideoElement ? el : null
}
