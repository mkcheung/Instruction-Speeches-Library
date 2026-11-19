import { useCallback, useEffect, useRef, useState } from 'react'
import type Player from 'video.js/dist/types/player'
import type { Speech } from '@/features/speech/types'
import { useLazyGetPlaybackUrlQuery } from '@/features/speech/speechApi'
import { useCaptionsJob, useCaptionsBlobUrl } from '@/hooks/useCaptionsJob'
import { useCaptionsAnchor } from '@/components/annotation/captionsAnchor'
import { getVideoElement, getCaptionsTrack, setCaptionsTrack } from '@/shared/media/videojs-adapter'

/** The player is live and still drives this exact `<video>`. */
export function isLiveBinding(player: Player, video: HTMLVideoElement): boolean {
  return !player.isDisposed() && getVideoElement(player) === video
}

type PlaybackSource = {
  key: string
  speechId: number
  assetId: number
  url: string
  generation: number
}

type ReadyPlayback = {
  source: PlaybackSource
  player: Player
  video: HTMLVideoElement
}

export function useSpeechWatchMedia({ speechId, speech, asset, currentSpeech }: {
  speechId: number
  speech: Speech | undefined
  asset: Speech['primary_video'] | undefined
  currentSpeech: boolean
}) {
  const [fetchPlaybackUrl] = useLazyGetPlaybackUrlQuery()
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource | null>(null)
  const initialUrl = playbackSource?.url ?? null
  const [readyPlayback, setReadyPlayback] = useState<ReadyPlayback | null>(null)
  const playerRef = useRef<Player | null>(null)
  // Render-triggering state, deliberately not a bare ref — §8.2: a ref
  // mutation doesn't re-render, so `useTimedAnnotations` (inside
  // `useCommentaryTrack`) would never see the element and would silently
  // never attach.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  // W2/W4: the real ratio, once the browser has decoded metadata — takes
  // priority over the poster-seeded guess below once it arrives.
  const [measuredAr, setMeasuredAr] = useState<number | undefined>(undefined)
  // STEP-09: the real native `TextTrack` once `setCaptionsTrack` has
  // attached one — `null` until both the player is ready AND a caption
  // job has produced VTT text. Render-triggering state (not a ref, same
  // reasoning as `videoEl` above) — `useCaptionsAnchor`/`CaptionsToggle`
  // both need a re-render when this changes.
  const [captionsTrack, setCaptionsTrackState] = useState<TextTrack | null>(null)
  // Bumped by `VideoPlayer`'s `onSourceRefreshed` every time the
  // error-driven signed-URL refresh (§9.3) actually reloads the video —
  // video.js strips remote text tracks (including captions) on every
  // `src` reassignment, and nothing else about that refresh is visible to
  // React (it's entirely internal to `videojs-adapter.ts`'s error
  // handler). Included in the caption-attach effect's own deps below so
  // that effect re-runs and re-adds the caption track after every refresh,
  // not just after the initial job completion or an edit.
  const [sourceRefreshToken, setSourceRefreshToken] = useState(0)
  const requestSpeechId = currentSpeech && asset?.status === 'ready' ? speechId : null
  const requestAssetId = requestSpeechId !== null ? asset!.id : null

  useEffect(() => {
    if (requestSpeechId === null || requestAssetId === null) return
    let cancelled = false
    const key = `${requestSpeechId}:${requestAssetId}`
    fetchPlaybackUrl({ speechId: requestSpeechId, assetId: requestAssetId }).unwrap()
      .then(({ url }) => {
        if (cancelled) return
        setPlaybackSource((previous) => previous?.key === key && previous.url === url
          ? previous
          : { key, speechId: requestSpeechId, assetId: requestAssetId, url,
            generation: (previous?.generation ?? 0) + 1 })
      })
      .catch(() => {
        if (cancelled) return
        // A same-source refresh retains its mounted editor. A genuinely new
        // source's initial failure returns to the existing not-ready surface.
        setPlaybackSource((previous) => previous?.key === key ? previous : null)
      })
    return () => { cancelled = true }
  }, [fetchPlaybackUrl, requestSpeechId, requestAssetId])

  // VideoPlayer keeps the latest callback for refreshes. Bind that callback
  // to the source actually rendered, including when A is retained on route B.
  const refreshUrl = useCallback(async () => {
    if (!playbackSource) throw new Error('No playable asset.')
    const result = await fetchPlaybackUrl({
      speechId: playbackSource.speechId, assetId: playbackSource.assetId,
    }).unwrap()
    return result.url
  }, [fetchPlaybackUrl, playbackSource])

  const onPlayerReady = useCallback((player: Player) => {
    if (!playbackSource || player.isDisposed()) return
    const video = getVideoElement(player)
    if (!video) return
    playerRef.current = player
    setVideoEl(video)
    setReadyPlayback({ source: playbackSource, player, video })
  }, [playbackSource])

  // W2/W4: `videoEl` is a real `<video>` element (`getVideoElement`) — its
  // own `loadedmetadata` gives the true, display-correct ratio (autorotate
  // already applied by the browser), so this listens directly rather than
  // going through video.js's player events.
  useEffect(() => {
    if (!videoEl) return
    const updateFromElement = () => {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        setMeasuredAr(videoEl.videoWidth / videoEl.videoHeight)
      }
    }
    // Covers the case where metadata is already loaded by the time this
    // effect attaches (e.g. a cached video), not just the future event.
    updateFromElement()
    videoEl.addEventListener('loadedmetadata', updateFromElement)
    return () => videoEl.removeEventListener('loadedmetadata', updateFromElement)
  }, [videoEl])

  // W2's mandatory fallback chain: measured ratio (post-`loadedmetadata`)
  // -> poster's persisted dimensions (display-correct, W4) -> the video
  // asset's own persisted, rotation-corrected dimensions (W4 "Source 2",
  // for the posterless case) -> 16/9. Never leave `--video-ar` unset — an
  // unset custom property makes the width `calc()` invalid, `width` falls
  // back to `auto`, and `margin-inline: auto` then collapses the box to
  // 0x0 in every engine (measured).
  const posterAr =
    speech?.poster && speech.poster.width > 0 && speech.poster.height > 0
      ? speech.poster.width / speech.poster.height
      : undefined
  const assetAr = asset && asset.width && asset.height ? asset.width / asset.height : undefined
  const videoAr = measuredAr ?? posterAr ?? assetAr ?? 16 / 9

  // STEP-09-captions.md's acceptance list: the video reaches `ready`
  // before the caption job finishes, so this is gated on the VIDEO
  // asset's own readiness, not on anything caption-specific — a speech
  // with no captions yet (or ever) still plays fine, this hook just never
  // finds anything to attach.
  const { captions } = useCaptionsJob(speechId, asset?.status === 'ready')
  const captionsBlobUrl = useCaptionsBlobUrl(
    captions?.status === 'ready' && captions.vtt ? captions.vtt : undefined,
  )

  // Attaches/replaces the native `<track kind="captions">` once the
  // player exists (`videoEl` only becomes non-null once `player.ready()`
  // has fired — see `onPlayerReady` below) and whenever a fresh caption
  // URL shows up (job completes, or a caption edit re-derives the VTT and
  // this effect's `captionsBlobUrl` dependency changes). Deliberately does
  // NOT recreate the whole player (unlike the `initialUrl`-keyed effect
  // that builds it) — captions attach onto the existing player instance.
  useEffect(() => {
    const player = playerRef.current
    // The previous ready binding can outlive source disposal until the new
    // player's deferred ready callback supplies its concrete video element.
    if (!player || !videoEl || !isLiveBinding(player, videoEl)) return
    setCaptionsTrack(player, captionsBlobUrl ? { src: captionsBlobUrl, label: 'English' } : null)
    setCaptionsTrackState(getCaptionsTrack(player))
    // `sourceRefreshToken` is otherwise unread here — its only job is to
    // force this effect to re-run (and thus re-add the caption track)
    // after a signed-URL refresh strips it, per the comment on its
    // declaration above.
  }, [videoEl, captionsBlobUrl, sourceRefreshToken])

  // §8.6/STEP-09's "Deliberately stubbed" hook, live for the first time:
  // anchors the annotation overlay to the top whenever captions are
  // showing, so native bottom-centre captions and the overlay never
  // collide.
  const captionsAnchor = useCaptionsAnchor(captionsTrack)

  // Shared media provenance, independent of the branch's authorization policy.
  // A ready state record alone can outlive a disposed/recreated concrete tech.
  const concreteReady = !!playbackSource && readyPlayback?.source.key === playbackSource.key &&
    readyPlayback.source.generation === playbackSource.generation &&
    videoEl === readyPlayback.video &&
    isLiveBinding(readyPlayback.player, readyPlayback.video)
  return { playbackSource, initialUrl, readyPlayback, playerRef, videoEl, sourceRefreshToken,
    setSourceRefreshToken, refreshUrl, onPlayerReady, videoAr, captions, captionsTrack, captionsAnchor, concreteReady }
}
