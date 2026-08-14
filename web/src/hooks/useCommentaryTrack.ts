import { useEffect, useRef, useState } from 'react'
import { skipToken } from '@reduxjs/toolkit/query/react'
import { useListSpeechReviewsQuery } from '@/features/review/reviewApi'
import type { Review } from '@/features/review/types'
import { useGetAnnotationsQuery, usePrefetchAnnotations } from '@/features/annotation/annotationApi'
import type { Annotation } from '@/features/annotation/types'
import { useTimedAnnotations } from '@/hooks/useTimedAnnotations'
import { useVideoCurrentTime } from '@/hooks/useVideoCurrentTime'
import { useIosFullscreenSubtitles } from '@/hooks/useIosFullscreenSubtitles'

export const NO_COMMENTARY = 'none' as const
export type CommentarySelection = number | typeof NO_COMMENTARY

/** MODERNIZATION_PLAN.md §5.4/§8.5's cross-fade: how long the outgoing set
 * gets to finish fading out before the array is swapped to the new
 * reviewer's data and the incoming set starts fading in. Matches
 * `OverlayStack`'s `GHOST_MS` / `index.css`'s 600ms transition. */
const CROSSFADE_OUT_MS = 650

const EMPTY_ANNOTATIONS: Annotation[] = []

/**
 * Imperative DOM write, not a React state mutation — `video` is the
 * native `<video>` element (see `getVideoElement`), and `currentTime` is
 * a live playback control, not render state. Pulled out to module scope
 * so the compiler's props/hook-argument immutability check (which flags
 * writing to a property reached from a hook's own parameter, even via an
 * alias) doesn't mistake this DOM write for a React immutability bug.
 */
function seekVideo(video: HTMLVideoElement, seconds: number): void {
  video.currentTime = seconds
}

export interface CommentaryTrackOption {
  key: CommentarySelection
  label: string
  review: Review | null
}

/**
 * All of STEP-06's watch-surface plumbing for one speech: the reviewer
 * radiogroup's data, the annotations fetch (reject-don't-fallback on
 * error, per the frozen contract), the cross-fade on track switch, the
 * timed-annotation engine, and the iOS native-fullscreen subtitle
 * fallback. Split out of `TrackSelector` so `SpeechWatch` can render
 * `OverlayStack` positioned over the actual `<video>` element while
 * `TrackSelector`/`Transcript` render below it, all sharing one source of
 * truth instead of three components independently re-deriving it.
 */
export function useCommentaryTrack(
  speechId: number,
  videoEl: HTMLVideoElement | null,
  /** `TrackSelector`/`OverlayStack` only render for the speaker (§8.5's
   * radiogroup is owner-only) — `SpeechWatch` passes `false` for every
   * other viewer so this hook's queries stay skipped rather than firing a
   * reviews-list request nobody uses. */
  enabled = true,
) {
  const { data: reviews, isLoading: reviewsLoading } = useListSpeechReviewsQuery(speechId, {
    skip: !enabled,
  })
  const [selected, setSelected] = useState<CommentarySelection>(NO_COMMENTARY)
  const prefetchAnnotations = usePrefetchAnnotations('getAnnotations')

  const {
    data: fetched,
    error,
    isFetching,
    refetch,
  } = useGetAnnotationsQuery(
    !enabled || selected === NO_COMMENTARY ? skipToken : { speechId, reviewId: selected },
  )

  // §5.4/§8.5's cross-fade: `displayed` is what's actually fed to the
  // engine and rendered — switching `selected` doesn't swap it
  // immediately. Instead: suppress (empty cues, so everything currently
  // visible fades out), then once BOTH the fade-out window has elapsed and
  // the new review's data has arrived, swap `displayed` and let the engine
  // fade the new set in.
  const [displayed, setDisplayed] = useState<Annotation[]>(EMPTY_ANNOTATIONS)
  const [fadeDone, setFadeDone] = useState(true)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [])

  const select = (next: CommentarySelection) => {
    if (next === selected) {
      // Re-selecting the current chip is what the error banner's "Try
      // again" means — `setSelected` to the same value is a no-op for RTK
      // Query, so the retry has to be explicit or the banner advertises a
      // dead button.
      if (error && next !== NO_COMMENTARY) void refetch()
      return
    }
    setSelected(next)
    setFadeDone(false)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    fadeTimerRef.current = setTimeout(() => setFadeDone(true), CROSSFADE_OUT_MS)
  }

  /** Is the data backing the CURRENT selection actually in hand? False
   * while the new reviewer's request is in flight and false forever on a
   * 403/404 — the timer alone must never un-suppress, or a fetch slower
   * than the fade re-reveals the PREVIOUS reviewer's overlays under the new
   * reviewer's name (and an error would leave them up permanently, which is
   * exactly the silent fall-back the contract forbids). */
  const dataReady =
    selected === NO_COMMENTARY || (!!fetched && fetched.review_id === selected)

  // Once the newly-selected review's annotations arrive AND the fade-out
  // window has elapsed, swap the displayed array — the "swap the array"
  // step; the hook re-evaluates synchronously at the current time once
  // `displayed` changes, fading the new set in.
  useEffect(() => {
    if (!fadeDone) return
    if (selected === NO_COMMENTARY) {
      const clear = () => setDisplayed(EMPTY_ANNOTATIONS)
      clear()
      return
    }
    if (!fetched || fetched.review_id !== selected) return
    const swapIn = () => setDisplayed(fetched.annotations)
    swapIn()
  }, [fetched, selected, fadeDone])

  const crossfading = !fadeDone || !dataReady
  const cues = crossfading ? EMPTY_ANNOTATIONS : displayed
  const activeIds = useTimedAnnotations(videoEl, cues)
  const currentTime = useVideoCurrentTime(videoEl)
  useIosFullscreenSubtitles(videoEl, cues)

  const options: CommentaryTrackOption[] = [
    { key: NO_COMMENTARY, label: 'No commentary', review: null },
    ...(reviews ?? []).map((review) => ({
      key: review.id,
      label: review.reviewer?.name ?? 'Reviewer',
      review,
    })),
  ]

  const prefetch = (key: CommentarySelection) => {
    if (typeof key === 'number') prefetchAnnotations({ speechId, reviewId: key })
  }

  const seek = (seconds: number) => {
    if (videoEl) seekVideo(videoEl, seconds)
  }

  return {
    options,
    optionsLoading: reviewsLoading,
    selected,
    select,
    prefetch,
    error,
    isFetching,
    // Only name the reviewer once their data is the data on screen —
    // otherwise `TrackSelector`'s "…hasn't left commentary yet" empty state
    // fires against the deliberately-emptied cross-fade array.
    fetchedReviewerName: crossfading ? undefined : fetched?.reviewer?.name,
    // `cues`, not `displayed`: the overlay and the transcript are two
    // presentations of the SAME set (§8.5/§8.6), so the transcript must not
    // keep listing the outgoing reviewer's rows while the overlays are
    // suppressed — least of all under the new reviewer's name after an error.
    annotations: cues,
    activeIds,
    currentTime,
    seek,
  }
}
