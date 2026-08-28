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
  /**
   * Fired once the reassigned `src` has actually loaded (same
   * `loadedmetadata` moment position/play-state get restored below) after
   * an error-driven URL refresh. `addRemoteTextTrack`'s `manualCleanup:
   * false` (see `setCaptionsTrack` below) means video.js strips any
   * remote text track — including the caption `<track>` — on every `src`
   * reassignment, this refresh path included. Nothing here re-adds one:
   * that's the caller's job (`setCaptionsTrack` needs the caption URL,
   * which this adapter doesn't have), so this callback is the caller's one
   * hook to know a reattach is needed.
   */
  onSourceRefreshed?: () => void
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
    // video.js 8 defaults Chromium to emulated text tracks even though the
    // browser implements native HTML text tracks. STEP-09's contract is
    // deliberately stricter: captions must exist on the real
    // HTMLVideoElement (`video.textTracks`) and as a real child `<track>`
    // so browser-native rendering and user caption preferences apply.
    // Without this override, `player.textTracks()` reports the emulated
    // caption while `video.textTracks` and the DOM remain empty — making
    // the UI claim "Captions on" for a track the browser does not own.
    html5: { nativeTextTracks: true },
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
          options.onSourceRefreshed?.()
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

/**
 * video.js's own `TextTrackList`/`TextTrack` types (`dist/types/tracks/*`)
 * don't declare a numeric indexer on the list (only `.length`, per its
 * shared `TrackList` base) even though the runtime object is indexable —
 * a real, if imprecise, upstream type gap. This is the one place that
 * reads across that gap, so every caller downstream keeps working with the
 * plain DOM `TextTrack` type (`captionsAnchor.ts`, `OverlayStack.tsx`
 * already type against it) rather than video.js's parallel internal one.
 */
function toArray<T>(list: { length: number }): T[] {
  const items: T[] = []
  for (let i = 0; i < list.length; i++) {
    items.push((list as unknown as Record<number, T>)[i])
  }
  return items
}

/**
 * STEP-09-captions.md/STEP-09-FROZEN-CONTRACT.md §5: "a real `<track
 * kind='captions' default>` — so the browser's native renderer and the
 * user's own caption styling apply." Added via `addRemoteTextTrack`
 * (rather than threaded into `videojs(...)`'s own `tracks` option at
 * construction) because the caption VTT is only known once
 * `captionApi`'s `getCaptions` query resolves, well after the player is
 * created — this must be callable at any point in the player's life, not
 * just at construction.
 *
 * Removes any previously-added remote captions track first (`manualCleanup:
 * false` on `addRemoteTextTrack` means video.js already clears remote
 * tracks on a `src` change, e.g. the §9.3 URL-refresh path — this covers
 * the OTHER case, a caller passing a fresh caption URL, or `null`, without
 * the video source itself changing), so repeated calls never accumulate
 * duplicate `<track>`s. Callers read the resulting `TextTrack` back via
 * `getCaptionsTrack`, not a return value here — video.js's own
 * `HTMLTrackElement` type doesn't expose `.track` (another type gap).
 */
export function setCaptionsTrack(
  player: Player,
  captions: { src: string; label?: string; srclang?: string } | null,
): void {
  const existing = toArray<TextTrack>(player.remoteTextTracks())
  // Remember whether the viewer had captions showing before we replace the
  // track. `default: true` re-adds it in the showing state, and
  // SpeechWatch re-runs its attach effect on every signed-URL refresh
  // (~600s, MediaUrlSigner::DEFAULT_TTL_SECONDS) — so a viewer who turned
  // captions OFF had them silently turn themselves back on mid-watch, with
  // the CC button flipping back to "Captions on" unprompted. Only the
  // FIRST attach should default to showing.
  let wasDisabled = false
  for (const track of existing) {
    if (track.kind !== 'captions') continue
    if (track.mode !== 'showing') wasDisabled = true
    player.removeRemoteTextTrack(track)
  }

  if (!captions) return

  player.addRemoteTextTrack(
    {
      kind: 'captions',
      src: captions.src,
      srclang: captions.srclang ?? 'en',
      label: captions.label ?? 'English',
      default: !wasDisabled,
    },
    false,
  )

  if (wasDisabled) {
    const added = getCaptionsTrack(player)
    if (added) added.mode = 'disabled'
  }
}

/** The current `kind: 'captions'` `TextTrack`, if one has been added via
 * `setCaptionsTrack` — `null` otherwise. Read the adapter-owned remote
 * list, not `player.textTracks()`: with native tracks, video.js updates
 * that general list asynchronously after a same-task replacement and can
 * briefly return the track we just removed. `remoteTextTracks()` is
 * updated synchronously by the add/remove calls above, so React always
 * receives the live track whose `.mode` the browser actually renders.
 * Callers (`useCaptionsAnchor`, the CC toggle) poll/read `.mode` off this,
 * exactly as `captionsAnchor.ts`'s docblock expected. */
export function getCaptionsTrack(player: Player): TextTrack | null {
  const tracks = toArray<TextTrack>(player.remoteTextTracks())
  return tracks.find((t) => t.kind === 'captions') ?? null
}
