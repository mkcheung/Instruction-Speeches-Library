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
    fluid: true,
    playsinline: true,
    poster: options.poster,
    sources: [{ src: options.initialUrl, type: 'video/mp4' }],
  })

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
