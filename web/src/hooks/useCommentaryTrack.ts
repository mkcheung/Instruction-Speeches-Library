import { useEffect, useMemo, useRef, useState } from 'react'
import { skipToken } from '@reduxjs/toolkit/query/react'
import { useListReviewRosterQuery } from '@/features/review/reviewApi'
import type { RosterReview } from '@/features/review/types'
import { useGetAnnotationsQuery, usePrefetchAnnotations } from '@/features/annotation/annotationApi'
import type { Annotation } from '@/features/annotation/types'
import { useTimedAnnotations } from '@/hooks/useTimedAnnotations'
import { useVideoCurrentTime } from '@/hooks/useVideoCurrentTime'
import { useIosFullscreenSubtitles } from '@/hooks/useIosFullscreenSubtitles'
import { useVoiceCommentaryPreference } from '@/hooks/useVoiceCommentaryPreference'
import { useVoiceInterjections } from '@/hooks/useVoiceInterjections'
import { reviewerLabel } from '@/lib/reviewerLabel'
import { hasUnseenCommentary, markCommentarySeen } from '@/lib/lastSeenCommentary'

/** `Review::ACCESS_GRANTING` (`api/app/Models/Review.php`) — mirrored here
 * rather than re-fetched, same precedent as `useMyReviewForSpeech.ts`'s
 * identical constant: the frontend has no endpoint that returns the
 * backend enum itself, and it's stable across this codebase's steps. This
 * hook used to get this filtering for free from `forSpeech`/
 * `listSpeechReviews` server-side; now that it reads the unfiltered
 * `review-roster` endpoint (IMPLEMENTATION-PLANS.md §13 seam 1 — the
 * roster is where §7.2 put the counts this feature needs, and
 * `ReviewResource` deliberately does not carry them), the chip list has to
 * apply the same access-granting-and-not-revoked filter client-side that
 * `forSpeech` used to apply server-side, to keep the exact same set of
 * rows selectable as before this change. */
const ACCESS_GRANTING = new Set(['accepted', 'in_progress', 'published'])

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
  review: RosterReview | null
  /** §7.4: the count badge — `review.published_annotations_count`, 0 for
   * `NO_COMMENTARY` (there is nothing to count). Deliberately NOT
   * `annotations_count`: that counter includes the reviewer's own
   * unpublished drafts, which `AnnotationService::forReview`'s
   * `visibleTo()` scope never lets the speaker see (`published_at IS NOT
   * NULL` for anyone but the review's own author) — badging the draft
   * total here would both mislead (the badge count would exceed what the
   * transcript actually shows once selected) and leak how many drafts a
   * reviewer is sitting on, which is exactly the "the speaker must never
   * see a coach's drafts" invariant `Annotation::scopeVisibleTo`'s own
   * comment states. */
  noteCount: number
  /** §7.4: the unread dot — always `false` for `NO_COMMENTARY`. */
  hasUnread: boolean
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
  userId?: string,
) {
  const { data: roster, isLoading: reviewsLoading } = useListReviewRosterQuery(speechId, {
    skip: !enabled,
  })
  // See the `ACCESS_GRANTING` comment above — `review-roster` returns
  // every status including revoked/declined/abandoned (that's the whole
  // point of it for `ReviewerRoster`); this hook only ever wants the same
  // subset `forSpeech` used to pre-filter.
  //
  // `useMemo`'d on `roster` itself, not recomputed as a bare `.filter()`
  // on every render: `roster` is a stable reference from RTK Query (same
  // object across renders unless the data actually changed), but `.filter()`
  // always returns a brand-new array. Without memoizing, `reviews` would
  // get a new identity on every re-render of this hook — including the
  // frequent ones `useVideoCurrentTime` drives during playback — which
  // feeds straight into the stale-selection-reset effect below's
  // dependency array and made it re-run on every single tick instead of
  // only when the roster data actually changed.
  const reviews = useMemo(
    () => roster?.filter((r) => r.revoked_at === null && ACCESS_GRANTING.has(r.status)),
    [roster],
  )
  const [selected, setSelected] = useState<CommentarySelection>(NO_COMMENTARY)
  // §7.4: the default-selection effect below (which auto-picks the most
  // recently published track on first load) must fire at most once per
  // mount — never re-firing after a speaker has deliberately navigated
  // back to "No commentary" themselves.
  const didAutoSelectRef = useRef(false)
  const prefetchAnnotations = usePrefetchAnnotations('getAnnotations')

  const {
    data: fetched,
    error,
    isFetching,
    refetch,
  } = useGetAnnotationsQuery(
    !enabled || selected === NO_COMMENTARY ? skipToken : { speechId, reviewId: selected },
    { pollingInterval: 3000, skipPollingIfUnfocused: true },
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
    // §7.4's unread dot: marking "seen" happens once the selection's data
    // has actually arrived (see the swap-in effect below), not here at
    // the moment of selection — selecting a track that then 403s/404s/
    // network-fails must not clear the "new" signal for commentary the
    // speaker never actually saw.
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

    // §7.4's unread dot: this is the point where the selection's data is
    // actually in hand and about to render — "seen" means THIS, not merely
    // "a selection was attempted." Fires for both a manual click and the
    // auto-default effect above, since both go through `select()` /
    // `setSelected` and land here identically once their fetch resolves.
    const target = reviews?.find((r) => r.id === fetched.review_id)
    if (target?.last_published_at) markCommentarySeen(speechId, fetched.review_id, target.last_published_at)
  }, [fetched, selected, fadeDone, reviews, speechId])

  const crossfading = !fadeDone || !dataReady
  const cues = crossfading ? EMPTY_ANNOTATIONS : displayed
  const voicePreference = useVoiceCommentaryPreference(userId, speechId)
  const voiceNotes = cues.filter((annotation) => annotation.voice !== null)
  const visibleAnnotations =
    voicePreference.mode === 'none' ? cues.filter((annotation) => annotation.voice === null) : cues
  const timedAnnotations =
    voicePreference.mode === 'play'
      ? visibleAnnotations.filter((annotation) => annotation.voice === null)
      : visibleAnnotations
  const timedActiveIds = useTimedAnnotations(videoEl, timedAnnotations)
  const voicePlayback = useVoiceInterjections({
    speechId,
    videoEl,
    notes: voiceNotes,
    mode: voicePreference.mode,
    onExperienced: voicePreference.markExperienced,
    resetKey: selected,
  })
  const activeIds = new Set(timedActiveIds)
  if (voicePlayback.current) activeIds.add(voicePlayback.current.id)
  const currentTime = useVideoCurrentTime(videoEl)
  // Native fullscreen receives only the text projection for the selected
  // mode. In Play mode, voice notes are audio interjections—not long-lived
  // subtitle cues using their recording duration.
  useIosFullscreenSubtitles(videoEl, timedAnnotations)

  const options: CommentaryTrackOption[] = [
    { key: NO_COMMENTARY, label: 'No commentary', review: null, noteCount: 0, hasUnread: false },
    ...(reviews ?? []).map((review) => ({
      key: review.id,
      label: reviewerLabel(review.reviewer) ?? 'Former reviewer',
      review,
      noteCount: review.published_annotations_count,
      hasUnread: hasUnseenCommentary(speechId, review.id, review.last_published_at),
    })),
  ]

  // IMPLEMENTATION-PLANS.md §7.4: "the default state of the screen whose
  // purpose is displaying feedback is displaying none" — default to the
  // review with the most recently published commentary (highest
  // `last_published_at` among reviews with a non-null `first_published_at`
  // — a review can be `accepted`/`in_progress` with nothing published yet,
  // which is not a candidate), falling back to `NO_COMMENTARY` when no
  // reviewer has published anything. Fires at most once per mount
  // (`didAutoSelectRef`): must never re-trigger after the speaker has
  // deliberately navigated back to "No commentary" themselves, and must
  // never fight the stale-selection-reset effect below (that one only
  // acts when `selected !== NO_COMMENTARY`; this one only acts when
  // `selected === NO_COMMENTARY` — the two conditions can't both hold).
  useEffect(() => {
    // `roster === undefined`, not `reviewsLoading` — RTK Query's `isLoading`
    // reads `false` on the render BEFORE the query's own subscription
    // effect has dispatched the request (its internal state starts
    // `isUninitialized`/`isLoading: false`, only flipping to `isLoading:
    // true` on a later commit). Gating on `reviewsLoading` let this effect
    // fire once, early, with `reviews` still `undefined` — `published`
    // came back empty, nothing got selected, but `didAutoSelectRef` latched
    // `true` anyway, permanently skipping the real run once data actually
    // arrived. Gating on the data itself has no such window: it simply
    // cannot be `undefined` before the roster has actually loaded.
    if (didAutoSelectRef.current || selected !== NO_COMMENTARY || roster === undefined) return
    didAutoSelectRef.current = true

    const published = (reviews ?? []).filter((r) => r.first_published_at !== null)
    if (published.length === 0) return

    const mostRecent = published.reduce((latest, candidate) =>
      new Date(candidate.last_published_at ?? 0).getTime() > new Date(latest.last_published_at ?? 0).getTime()
        ? candidate
        : latest,
    )

    // See the identical justification on the stale-selection-reset effect
    // below: `select()` also starts the cross-fade timer, an imperative
    // side effect no render-time derivation could perform, and this
    // reacts to async roster data arriving, not to state derivable from
    // props.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    select(mostRecent.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, selected])

  // IMPLEMENTATION-PLANS.md §7.2.6's second, pre-existing state bug —
  // newly reachable via this feature's own revoke action, but already
  // live via the admin panel's revoke with zero frontend involvement.
  // `reviews` (and thus `options`) comes from the roster, filtered above to
  // access-granting, non-revoked rows — the instant the
  // CURRENTLY SELECTED reviewer is revoked, that row drops out of
  // `options` on the next refetch, but `selected` is plain `useState` and
  // has no reason to change on its own: it would keep holding the dead
  // id, and `TrackSelector` would keep rendering a chip for a reviewer no
  // longer in the selector at all, with annotations frozen on whatever
  // was last fetched (`getAnnotations` for that id is never re-requested
  // once `fetched.review_id === selected` already matched). Resetting to
  // `NO_COMMENTARY` here — not re-selecting some other reviewer — matches
  // §8.5's existing error/suppression behavior: the safe state is "no
  // commentary showing," never a silent fall-back to a different track
  // the viewer didn't choose.
  useEffect(() => {
    if (selected === NO_COMMENTARY) return
    if (!reviewsLoading && !options.some((option) => option.key === selected)) {
      // Routed through `select`, not a raw `setSelected` — this keeps the
      // same cross-fade-out behavior §5.4/§8.5 already guarantees for
      // every other transition, rather than snapping the overlay away.
      //
      // `set-state-in-effect` deliberately disabled, not restructured:
      // `select()` isn't a pure state derivation that could move to
      // render — it also clears/starts the cross-fade timer (an
      // imperative side effect, not a render-time computation), and the
      // reset is a reaction to `reviews` (async RTK Query data) arriving,
      // which is exactly the "synchronize with an external data source"
      // case effects exist for, not the "state derivable from props"
      // case the rule guards against.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      select(NO_COMMENTARY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews, reviewsLoading, selected])

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
    fetchedReviewerName: crossfading ? undefined : reviewerLabel(fetched?.reviewer),
    // `cues`, not `displayed`: the overlay and the transcript are two
    // presentations of the SAME set (§8.5/§8.6), so the transcript must not
    // keep listing the outgoing reviewer's rows while the overlays are
    // suppressed — least of all under the new reviewer's name after an error.
    annotations: visibleAnnotations,
    activeIds,
    currentTime,
    seek,
    voiceMode: voicePreference.mode,
    selectVoiceMode: voicePreference.select,
    voicePlayback,
  }
}
