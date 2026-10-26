import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { skipToken } from '@reduxjs/toolkit/query/react'
import { useListReviewRosterQuery } from '@/features/review/reviewApi'
import type { RosterReview } from '@/features/review/types'
import { useGetAnnotationsQuery, usePrefetchAnnotations } from '@/features/annotation/annotationApi'
import type { Annotation } from '@/features/annotation/types'
import { useTimedAnnotations } from '@/hooks/useTimedAnnotations'
import { useVideoCurrentTime } from '@/hooks/useVideoCurrentTime'
import { useIosFullscreenSubtitles } from '@/hooks/useIosFullscreenSubtitles'
import { useCommentaryPlaybackPreference } from '@/hooks/useCommentaryPlaybackPreference'
import { useVoiceInterjections } from '@/hooks/useVoiceInterjections'
import { projectCommentary } from '@/lib/commentaryPlayback'
import { isTerminalAccessError } from '@/lib/errorStatus'
import { isAccessGrantingReviewStatus } from '@/features/review/reviewAccess'
import { reviewerLabel } from '@/lib/reviewerLabel'
import { hasUnseenCommentary, markCommentarySeen } from '@/lib/lastSeenCommentary'

export const NO_COMMENTARY = 'none' as const
export type CommentarySelection = number | typeof NO_COMMENTARY
const CROSSFADE_OUT_MS = 650
const EMPTY_ANNOTATIONS: Annotation[] = []

function seekVideo(video: HTMLVideoElement, seconds: number): void {
  video.currentTime = seconds
}

export interface CommentaryTrackOption {
  key: CommentarySelection
  label: string
  review: RosterReview | null
  /** Total speaker-visible published rows, never the draft-inclusive count. */
  noteCount: number
  hasUnread: boolean
}

/** Authorized source rows stay canonical. Every presentation gets its own projection. */
export function useCommentaryTrack(
  speechId: number,
  videoEl: HTMLVideoElement | null,
  enabled = true,
  userId?: string,
  notesVisible = true,
) {
  const ownerEnabled = enabled && !!userId && Number.isSafeInteger(speechId) && speechId > 0
  const context = `${userId ?? ''}:${speechId}`
  const { currentData: roster, isLoading: reviewsLoading, error: rosterError } = useListReviewRosterQuery(speechId, {
    skip: !ownerEnabled,
    pollingInterval: 3000,
    skipPollingIfUnfocused: true,
  })
  const reviews = useMemo(() => roster?.filter((r) => r.revoked_at === null && isAccessGrantingReviewStatus(r.status)), [roster])
  const [choice, setChoice] = useState<{ context: string; selected: CommentarySelection; initialized: boolean }>({
    context, selected: NO_COMMENTARY, initialized: false,
  })
  const candidate = choice.context === context ? choice.selected : NO_COMMENTARY
  const selected = candidate !== NO_COMMENTARY && reviews?.some((review) => review.id === candidate)
    ? candidate : NO_COMMENTARY
  const [fadeKey, setFadeKey] = useState('')
  const selectionKey = `${context}:${selected}`
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefetchAnnotations = usePrefetchAnnotations('getAnnotations')
  const { currentData: fetched, error, isFetching, refetch } = useGetAnnotationsQuery(
    !ownerEnabled || selected === NO_COMMENTARY ? skipToken : { speechId, reviewId: selected },
    { pollingInterval: 3000, skipPollingIfUnfocused: true },
  )
  const preference = useCommentaryPlaybackPreference(userId, speechId, ownerEnabled)
  const mode = preference.ready ? preference.mode : 'off'

  useEffect(() => () => { if (fadeTimer.current) clearTimeout(fadeTimer.current) }, [])
  const select = useCallback((next: CommentarySelection) => {
    if (next === candidate && choice.context === context && choice.initialized) {
      if (error && next !== NO_COMMENTARY) void refetch()
      return
    }
    setChoice({ context, selected: next, initialized: true })
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    fadeTimer.current = setTimeout(() => setFadeKey(`${context}:${next}`), CROSSFADE_OUT_MS)
  }, [candidate, choice.context, choice.initialized, context, error, refetch])

  useEffect(() => {
    if (!ownerEnabled || roster === undefined || (choice.context === context && choice.initialized)) return
    const published = (reviews ?? []).filter((review) => review.first_published_at !== null)
    const latest = published.reduce<RosterReview | null>((best, review) =>
      !best || new Date(review.last_published_at ?? 0).getTime() > new Date(best.last_published_at ?? 0).getTime() ? review : best, null)
    // Synchronize the initial selection and its crossfade with an asynchronous roster.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    select(latest?.id ?? NO_COMMENTARY)
  }, [choice.context, choice.initialized, context, ownerEnabled, reviews, roster, select])

  useEffect(() => {
    if (choice.context !== context || candidate === NO_COMMENTARY || roster === undefined) return
    if (!reviews?.some((review) => review.id === candidate)) {
      // Revocation immediately suppresses the derived selection; commit that empty state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      select(NO_COMMENTARY)
    }
  }, [candidate, choice.context, context, reviews, roster, select])

  const dataReady = selected !== NO_COMMENTARY && fetched?.review_id === selected
  const crossfading = selected !== NO_COMMENTARY && fadeKey !== selectionKey
  const accessDenied = isTerminalAccessError(error)
    || isTerminalAccessError(rosterError)
  const source = ownerEnabled && preference.ready && !preference.accessDenied && !accessDenied && dataReady && !crossfading
    ? fetched.annotations : EMPTY_ANNOTATIONS
  const projection = useMemo(() => projectCommentary(source, mode), [source, mode])
  const timedActiveIds = useTimedAnnotations(videoEl, projection.timedWritten)
  const voicePlayback = useVoiceInterjections({
    speechId,
    videoEl: ownerEnabled ? videoEl : null,
    notes: projection.voices,
    audioEnabled: ownerEnabled && preference.ready && !accessDenied && dataReady && !crossfading && projection.playAudio,
    resetKey: selectionKey,
  })
  const activeVoice = voicePlayback.current && (voicePlayback.state === 'playing' || voicePlayback.state === 'paused')
    ? voicePlayback.current : null
  const overlayVoice = projection.showVoiceTranscript ? activeVoice : null
  const overlayAnnotations = overlayVoice ? [...projection.timedWritten, overlayVoice] : projection.timedWritten
  const overlayActiveIds = new Set(timedActiveIds)
  if (overlayVoice) overlayActiveIds.add(overlayVoice.id)
  const readableActiveIds = new Set(timedActiveIds)
  if (activeVoice) readableActiveIds.add(activeVoice.id)
  const currentTime = useVideoCurrentTime(videoEl)
  useIosFullscreenSubtitles(videoEl, projection.timedWritten)

  const [, refreshUnread] = useState(0)
  const markRead = useCallback(() => {
    if (!ownerEnabled || !preference.ready || !dataReady || crossfading || isFetching || error || rosterError || source.length === 0) return
    const review = reviews?.find((row) => row.id === selected)
    if (review?.last_published_at && hasUnseenCommentary(speechId, review.id, review.last_published_at)) {
      markCommentarySeen(speechId, review.id, review.last_published_at)
      refreshUnread((value) => value + 1)
    }
  }, [crossfading, dataReady, error, isFetching, ownerEnabled, preference.ready, reviews, rosterError, selected, source.length, speechId])
  useEffect(() => {
    const readablePresented = notesVisible && (mode === 'all' || mode === 'written') && projection.readable.length > 0
    // Synchronize the visible publication with persistent seen state and refresh its badge once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (readablePresented || voicePlayback.state === 'playing') markRead()
  }, [markRead, mode, notesVisible, projection.readable.length, voicePlayback.state])

  const options: CommentaryTrackOption[] = (reviews ?? []).map((review) => ({
    key: review.id,
    label: reviewerLabel(review.reviewer) ?? 'Former reviewer',
    review,
    noteCount: review.published_annotations_count,
    hasUnread: hasUnseenCommentary(speechId, review.id, review.last_published_at),
  }))
  const prefetch = (key: CommentarySelection) => {
    if (ownerEnabled && typeof key === 'number') prefetchAnnotations({ speechId, reviewId: key })
  }
  const seek = (seconds: number) => { if (videoEl) seekVideo(videoEl, seconds) }

  return {
    options, optionsLoading: reviewsLoading, selected, select, prefetch,
    error: error ?? rosterError, isFetching,
    fetchedReviewerName: dataReady && !crossfading ? reviewerLabel(fetched?.reviewer) ?? 'Former reviewer' : undefined,
    annotations: projection.readable,
    allAnnotations: source,
    overlayAnnotations,
    overlayActiveIds,
    overlayVoiceId: overlayVoice?.id,
    markerAnnotations: projection.markers,
    navigationAnnotations: projection.navigation,
    activeIds: readableActiveIds,
    hideReadableBody: projection.hideReadableBody,
    currentTime, seek, mode, preference,
    selectMode: preference.select,
    voicePlayback, markRead,
    readingKey: `${selectionKey}:${mode}`,
  }
}
