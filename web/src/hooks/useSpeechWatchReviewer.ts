import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'react-redux'
import type { AppDispatch, RootState } from '@/app/store'
import type { Speech } from '@/features/speech/types'
import type { MeResponse } from '@/features/auth/types'
import type { Review, ReviewSections } from '@/features/review/types'
import { grantsSpeechAccess } from '@/features/review/reviewAccess'
import { reviewApi } from '@/features/review/reviewApi'
import { getErrorStatus, isTerminalAccessError } from '@/lib/errorStatus'
import { useMyReviewForSpeech } from '@/hooks/useMyReviewForSpeech'
import type { useSpeechWatchMedia } from '@/hooks/useSpeechWatchMedia'

type PresentationRegistration = { identity: string; node: HTMLDivElement; token: symbol }

/**
 * Identity-safe registration of a DOM node inside the reviewer presentation.
 * Returns the node only while it was registered for the current identity.
 * React 19 runs the exact registration's cleanup, so an older cleanup can
 * never clear its replacement, even within the same identity.
 */
function usePresentationTarget(key: string | null): [(node: HTMLDivElement | null) => void | (() => void), HTMLDivElement | null] {
  const [registration, setRegistration] = useState<PresentationRegistration | null>(null)
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (!node || !key) return
    const next = { identity: key, node, token: Symbol('reviewer presentation target') }
    setRegistration(next)
    return () => setRegistration((current) =>
      current?.token === next.token && current.node === node ? null : current)
  }, [key])
  return [ref, key && registration?.identity === key ? registration.node : null]
}

/** Recording lock report, keyed to the `${user}:${speech}:${review}` session that sent it. */
type RecordingLock = { scopeKey: string; locked: boolean }

function accessReview(sections: ReviewSections | undefined, speechId: number): Review | undefined {
  return Object.values(sections ?? {}).flat().find((review) => grantsSpeechAccess(review, speechId))
}

type TimelineValidation = {
  scope: string | null
  reviewId: number | null
  epoch: number
  baselineReviewRequestId: string | null
  terminalToken: string | null
  proofReviewId: number | null
  attempted: boolean
  pending: boolean
}

/**
 * listMyReviews has a user-agnostic cache key and normally omits reviewer.id.
 * Its retained rows therefore cannot authorize this new control. A bounded,
 * unsubscribed request proves this committed user/speech epoch instead. This
 * observes the existing query without creating a second subscription.
 */
function useReviewerTimelineValidation({
  scope, reviewId, speechId, authSpeechReady, denied,
}: {
  scope: string | null; reviewId: number | null; speechId: number
  authSpeechReady: boolean; denied: string | null
}) {
  const store = useStore<RootState>()
  const dispatch = store.dispatch as AppDispatch
  const query = reviewApi.endpoints.listMyReviews.useQueryState(undefined)
  const [validation, setValidation] = useState<TimelineValidation>({
    scope, reviewId, epoch: 0, baselineReviewRequestId: query.requestId ?? null,
    terminalToken: null, proofReviewId: null, attempted: false, pending: false,
  })
  // A void-key request already present on entry can belong to another
  // account. Neither its success nor its denial authorizes this epoch. Its
  // denial must still allow our one fresh, independently proven request.
  const terminalToken = denied ?? (query.status === 'rejected' && isTerminalAccessError(query.error) && query.requestId !== validation.baselineReviewRequestId
    ? `review:${query.requestId}:${getErrorStatus(query.error)}` : null)
  // Render adjustment prevents old proof appearing for one commit when auth,
  // route/review identity or a terminal denial changes. A later 500 cannot
  // restore erased proof. Fresh results may reconcile the review id first.
  if (validation.scope !== scope || (validation.reviewId !== reviewId && validation.proofReviewId !== reviewId)) {
    setValidation({ scope, reviewId, epoch: validation.epoch + 1, baselineReviewRequestId: query.requestId ?? null, terminalToken: null,
      proofReviewId: null, attempted: false, pending: false })
  } else if (terminalToken !== null && validation.terminalToken !== terminalToken) {
    setValidation({ ...validation, epoch: validation.epoch + 1, terminalToken,
      proofReviewId: null, attempted: true, pending: false })
  }
  const committed = useRef<{
    scope: string | null; epoch: number; speechId: number; allowed: boolean
  } | null>(null)
  const attempt = useRef<{ scope: string; epoch: number } | null>(null)
  useLayoutEffect(() => {
    const current = { scope, epoch: validation.epoch, speechId, allowed: authSpeechReady }
    committed.current = current
    return () => { if (committed.current === current) committed.current = null }
  }, [scope, validation.epoch, speechId, authSpeechReady])

  const verify = useCallback(() => {
    const context = committed.current
    if (!context?.scope || !context.allowed ||
      (attempt.current?.scope === context.scope && attempt.current.epoch === context.epoch)) return
    const verification = { scope: context.scope, epoch: context.epoch }
    attempt.current = verification
    setValidation((current) => current.scope === verification.scope && current.epoch === verification.epoch
      ? { ...current, attempted: true, pending: true } : current)
    const stillCurrent = () => {
      const latest = committed.current
      return latest?.scope === verification.scope && latest.epoch === verification.epoch && latest.allowed
    }
    void (async () => {
      try {
        // forceRefetch alone can join an older account's in-flight void-key
        // request. Wait without aborting its subscribers, then prove that OUR
        // request actually entered pending with a distinct requestId.
        const older = dispatch(reviewApi.util.getRunningQueryThunk('listMyReviews', undefined))
        if (older) await older
        if (!stillCurrent()) return
        const previous = reviewApi.endpoints.listMyReviews.select()(store.getState())
        const request = dispatch(reviewApi.endpoints.listMyReviews.initiate(undefined, {
          subscribe: false, forceRefetch: true,
        }))
        const started = reviewApi.endpoints.listMyReviews.select()(store.getState())
        const fresh = started.status === 'pending' && started.requestId === request.requestId &&
          started.requestId !== previous.requestId
        await request
        if (!stillCurrent() || !fresh) return
        const completed = reviewApi.endpoints.listMyReviews.select()(store.getState())
        if (completed.status !== 'fulfilled' || completed.requestId !== request.requestId) return
        const found = accessReview(completed.data, context.speechId)
        if (!found) return
        setValidation((current) => current.scope === verification.scope && current.epoch === verification.epoch
          ? { ...current, reviewId: found.id, proofReviewId: found.id } : current)
      } finally {
        if (attempt.current === verification) attempt.current = null
        setValidation((current) => current.scope === verification.scope && current.epoch === verification.epoch
          ? { ...current, pending: false } : current)
      }
    })()
  }, [dispatch, store])

  useEffect(() => {
    if (scope && authSpeechReady && !validation.attempted) verify()
  }, [scope, authSpeechReady, validation.attempted, verify])
  return {
    validated: scope !== null && validation.scope === scope && reviewId !== null &&
      validation.proofReviewId === reviewId && terminalToken === null,
    epoch: validation.epoch,
    pending: validation.pending,
    retry: scope && authSpeechReady ? verify : undefined,
  }
}

export function useSpeechWatchReviewer({ speechId, speech, asset, me, isOwner, isLoading, error, meLoading, meFetching, meError,
  authRequestId, speechRequestId, speechDenied, authDenied, speechIsRoute, currentSpeech, sourceIsCurrent, media }: {
  speechId: number
  speech: Speech | undefined
  asset: Speech['primary_video'] | undefined
  me: MeResponse | undefined
  isOwner: boolean
  isLoading: boolean
  error: unknown
  meLoading: boolean
  meFetching: boolean
  meError: unknown
  authRequestId: string | undefined
  speechRequestId: string | undefined
  speechDenied: boolean
  authDenied: boolean
  speechIsRoute: boolean
  currentSpeech: boolean
  sourceIsCurrent: boolean
  media: ReturnType<typeof useSpeechWatchMedia>
}) {
  const [reviewerTab, setReviewerTab] = useState('notes')
  const [recordingLock, setRecordingLock] = useState<RecordingLock | null>(null)
  const { playbackSource, sourceRefreshToken, concreteReady } = media
  // STEP-07: a non-owner who is themselves an access-granting reviewer of
  // this speech gets the authoring composer instead of the owner's
  // read-only TrackSelector — `enabled: !isOwner` keeps this skipped for
  // the owner and for a still-loading `speech`.
  const { review: myReview } = useMyReviewForSpeech(speechId, !isOwner && !!speech)

  // RTK Query can retain A during navigation to B. The new preview needs
  // the current route, resolved source generation and actual ready tech to
  // agree before a reviewer target can be published.
  const sourceMatches = currentSpeech && sourceIsCurrent
  // State records provenance; concrete player/tech checks also reject a ready
  // binding left behind after VideoPlayer disposes/recreates its source.
  const sourceReady = sourceMatches && concreteReady
  const previewIdentity = sourceReady && me?.user && !isOwner && grantsSpeechAccess(myReview, speechId)
    ? `${me.user.id}:${speechId}:${asset!.id}:${myReview.id}` : null
  const [registerPreviewTarget, previewTarget] = usePresentationTarget(previewIdentity)
  const [registerVoiceControlsTarget, voiceControlsTarget] = usePresentationTarget(previewIdentity)

  // Same key the panel remounts on. A lock report only counts for the session
  // it came from, so retained A state can never disable B's tabs.
  const reviewerScopeKey = me?.user && myReview ? `${me.user.id}:${speechId}:${myReview.id}` : null
  const reviewerRecordingLocked = reviewerScopeKey !== null &&
    recordingLock?.scopeKey === reviewerScopeKey && recordingLock.locked
  const reviewerValidationScope = me?.user && !meLoading && !isLoading && !isOwner &&
    speechIsRoute && grantsSpeechAccess(myReview, speechId)
    ? `${me.user.id}:${speechId}` : null
  const reviewerNavigation = useReviewerTimelineValidation({
    scope: reviewerValidationScope, reviewId: myReview?.id ?? null, speechId,
    authSpeechReady: !meLoading && !meFetching && !meError && !isLoading && !error,
    denied: authDenied ? `auth:${authRequestId}:${getErrorStatus(meError)}`
      : speechDenied ? `speech:${speechRequestId}:${getErrorStatus(error)}` : null,
  })
  // A background auth request retains data while its current account is
  // unresolved. Keep same-account proof, but lend it no navigation authority
  // until that request settles and the committed identity still matches.
  const reviewerScrubReady = reviewerNavigation.validated && !meLoading && !meFetching && !isLoading &&
    !authDenied && !speechDenied && speechIsRoute && sourceIsCurrent && concreteReady
  const reviewerScrubKey = `${reviewerValidationScope}:${myReview?.id}:${asset?.id}:${reviewerNavigation.epoch}:${playbackSource?.generation}:${sourceRefreshToken}`
  const onRecordingLockChange = useCallback((locked: boolean) => {
    if (reviewerScopeKey === null) return
    setRecordingLock((current) => {
      // A different session's "unlocked" (e.g. an old panel unmounting) must not
      // clobber this session's report.
      if (!locked && current && current.scopeKey !== reviewerScopeKey) return current
      return current?.scopeKey === reviewerScopeKey && current.locked === locked
        ? current : { scopeKey: reviewerScopeKey, locked }
    })
  }, [reviewerScopeKey])
  return { reviewerTab, setReviewerTab, myReview, previewIdentity, registerPreviewTarget, previewTarget,
    registerVoiceControlsTarget, voiceControlsTarget, reviewerRecordingLocked, reviewerNavigation,
    reviewerScrubReady, reviewerScrubKey, onRecordingLockChange }
}
