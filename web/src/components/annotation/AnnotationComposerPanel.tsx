import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { OverlayStack } from '@/components/annotation/OverlayStack'
import { TimelineStrip } from '@/components/annotation/TimelineStrip'
import { Composer } from '@/components/annotation/Composer'
import { VoiceRecorder } from '@/components/annotation/VoiceRecorder'
import { AnnotationList } from '@/components/annotation/AnnotationList'
import { RemovedAnnotationDrafts } from '@/components/annotation/RemovedAnnotationDrafts'
import { ClearAnnotationsDialog } from '@/components/annotation/ClearAnnotationsDialog'
import { ToastProvider, Toaster, useToastManager } from '@/components/ui/toast'
import { useGetAnnotationsQuery, useClearAnnotationsMutation } from '@/features/annotation/annotationApi'
import { useAbandonReviewMutation, usePublishReviewMutation } from '@/features/review/reviewApi'
import { useTimedAnnotations } from '@/hooks/useTimedAnnotations'
import { useVideoCurrentTime } from '@/hooks/useVideoCurrentTime'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { isTmpAnnotationId } from '@/lib/uuid'
import { annotationFieldsEqual } from '@/lib/annotationFields'
import { compareByStartThenId } from '@/lib/annotationOrder'
import { isPointAnnotation, type Annotation } from '@/features/annotation/types'
import { annotationGeometry, geometriesOverlap } from '@/lib/annotationTiming'
import type { Review } from '@/features/review/types'

/**
 * STEP-07-write-commentary.md's top-level orchestrator, rendered on
 * `SpeechWatch` for a viewer who is themselves an access-granting reviewer
 * of this speech (never the owner — the owner keeps `TrackSelector` /
 * STEP-06's read-only view).
 *
 * Owns the ONE `useTimedAnnotations` instance this whole authoring session
 * uses — the frozen contract is explicit that the composer's draft cue
 * must merge into this SAME instance, never a second parallel one. Server
 * rows (`getAnnotations`, already returning the caller's own draft +
 * published rows per `Annotation::scopeVisibleTo`) are overlaid with
 * `liveOverrides` — the current, possibly-unsaved field values of
 * whichever rows are actively being typed into or dragged — so the live
 * preview always shows what's on screen, not just what's persisted.
 */
export function AnnotationComposerPanel({
  speechId,
  review,
  videoEl,
  durationSeconds,
  userId,
  canRecordVoice,
  onSeek,
}: {
  speechId: number
  review: Review
  videoEl: HTMLVideoElement | null
  durationSeconds: number
  userId: string | undefined
  canRecordVoice: boolean
  onSeek: (seconds: number) => void
}) {
  return (
    <ToastProvider>
      <AnnotationComposerPanelInner
        key={`${userId}:${speechId}:${review.id}`}
        speechId={speechId}
        review={review}
        videoEl={videoEl}
        durationSeconds={durationSeconds}
        userId={userId}
        canRecordVoice={canRecordVoice}
        onSeek={onSeek}
      />
      <Toaster />
    </ToastProvider>
  )
}

function AnnotationComposerPanelInner({
  speechId,
  review,
  videoEl,
  durationSeconds,
  userId,
  canRecordVoice,
  onSeek,
}: {
  speechId: number
  review: Review
  videoEl: HTMLVideoElement | null
  durationSeconds: number
  userId: string | undefined
  canRecordVoice: boolean
  onSeek: (seconds: number) => void
}) {
  const reviewId = review.id
  const { data, isError, refetch } = useGetAnnotationsQuery(
    { speechId, reviewId },
    { pollingInterval: 3000, skipPollingIfUnfocused: true },
  )
  const serverRows = useMemo(() => data?.annotations ?? [], [data])
  const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null
  const writable = ['accepted', 'in_progress', 'published'].includes(review.status) && !review.revoked_at
  const [pendingWork, setPendingWork] = useState<Record<string, boolean>>({})
  const pendingWorkRef = useRef<Record<string, boolean>>({})
  const handlePendingChange = useCallback((id: string, pending: boolean) => {
    if (Boolean(pendingWorkRef.current[id]) === pending) return
    const next = { ...pendingWorkRef.current }
    if (pending) next[id] = true; else delete next[id]
    pendingWorkRef.current = next
    setPendingWork(next)
  }, [])
  const pending = Object.keys(pendingWork).length > 0
  const blocker = useBlocker(pending)
  useEffect(() => {
    if (!pending) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [pending])
  const legacyConflict = useMemo(() => serverRows.some((row, index) => {
    const geometry = annotationGeometry(row)
    return !geometry || row.timing_type === null || serverRows.slice(index + 1).some((other) => {
      const otherGeometry = annotationGeometry(other)
      return otherGeometry !== null && geometriesOverlap(geometry, otherGeometry)
    })
  }), [serverRows])

  const [liveOverrides, setLiveOverrides] = useState<Record<string, Annotation>>({})

  const handleLiveChange = useCallback((live: Annotation) => {
    setLiveOverrides((prev) => ({ ...prev, [live.id]: live }))
  }, [])

  const handleLiveRemove = useCallback((id: string) => {
    setLiveOverrides((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  // `merged` is a pure DERIVATION, not state-with-a-cleanup-effect: an
  // override is only used while it hasn't yet been caught up to by the
  // server (i.e. still mid-edit or mid-flush). Once `serverRows` reflects
  // the same values, the override is simply skipped here — never
  // explicitly pruned — so a saved edit doesn't keep shadowing the server
  // row forever (which would also block a future silent-adopt from a
  // sibling tab). `liveOverrides` itself is left to grow for the life of
  // the authoring session (bounded by the ≤200-per-set write cap), which
  // costs nothing worth optimizing for a single review's worth of rows.
  const merged = useMemo(() => {
    const byId = new Map<string, Annotation>()
    for (const row of serverRows) byId.set(row.id, row)
    for (const [id, live] of Object.entries(liveOverrides)) {
      const serverRow = byId.get(id)
      if (serverRow && annotationFieldsEqual(live, serverRow)) continue
      byId.set(id, live)
    }
    return [...byId.values()]
  }, [serverRows, liveOverrides])

  const draftIds = useMemo(() => new Set(Object.keys(liveOverrides).filter(isTmpAnnotationId)), [liveOverrides])

  // The ONE useTimedAnnotations instance for this authoring session — fed
  // the merged saved+draft set, never a second parallel instance.
  const timedRows = useMemo(() => merged.filter((row) => !isPointAnnotation(row)), [merged])
  const activeIds = useTimedAnnotations(videoEl, timedRows)
  const currentTime = useVideoCurrentTime(videoEl)
  const voiceRows = useMemo(() => serverRows.filter((row) => row.voice !== null), [serverRows])
  const voiceDuration = useMemo(
    () => voiceRows.reduce((total, row) => total + row.duration_seconds, 0),
    [voiceRows],
  )

  const [clearAnnotations, { isLoading: isClearing }] = useClearAnnotationsMutation()
  const [publishReview, { isLoading: isPublishing }] = usePublishReviewMutation()
  const [abandonReview, { isLoading: isAbandoning }] = useAbandonReviewMutation()
  const toastManager = useToastManager()
  const navigate = useNavigate()

  // IMPLEMENTATION-PLANS.md §7.7.6: the ALWAYS-mounted new-draft
  // `Composer` below hands up its current `useAnnotationEditor` instance's
  // `setToPlayhead` via `onEditorReady` — re-fired every time the composer
  // regenerates into a fresh draft (its own docblock), so this always
  // targets the CURRENT draft, never a stale/completed one. This is the
  // function the keyboard map's global `C`/`Alt+C` calls below — the same
  // one the visible "Set to playhead" button (`AnnotationEditor.tsx:145`)
  // already calls for this draft. Deliberately scoped to the new-draft
  // composer only, not to whichever existing row happens to be open for
  // in-place editing (`AnnotationRow`'s per-row editors) — those already
  // have their own visible "Set to playhead" button right next to the
  // field being edited, and STEP-07's demo script ("watch, type at a
  // timestamp") is about composing a NEW note, not re-stamping a saved
  // one.
  const [composerSetToPlayhead, setComposerSetToPlayhead] = useState<(() => void) | undefined>(undefined)
  // `setComposerSetToPlayhead(fn)` would be wrong here: a function passed
  // directly to a useState setter is treated as an updater and CALLED
  // immediately with the previous state, not stored — which silently
  // invoked `setToPlayhead()` on every mount (stamping `start_seconds` to
  // the then-current playhead, usually 0, before the user ever pressed
  // anything). The `() => fn` wrapper is the standard escape hatch: React
  // calls the wrapper (ignoring its unused prevState arg) and stores ITS
  // return value, `fn`, instead of invoking `fn` itself.
  const handleComposerEditorReady = useCallback((fn: () => void) => setComposerSetToPlayhead(() => fn), [])

  const currentId = useMemo(() => {
    let best: Annotation | null = null
    for (const a of merged) {
      if (activeIds.has(a.id) && (!best || a.start_seconds > best.start_seconds)) best = a
    }
    if (best) return best.id
    const sorted = [...merged].sort(compareByStartThenId)
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].start_seconds <= currentTime) return sorted[i].id
    }
    return null
  }, [merged, activeIds, currentTime])

  const handlePublish = async () => {
    if (Object.keys(pendingWorkRef.current).length > 0 || !data || !writable) return
    try {
      const result = await publishReview(reviewId).unwrap()
      toastManager.add({
        title: `Published ${result.published_count} note${result.published_count === 1 ? '' : 's'}`,
        // §6.11's publish-time notice.
        description: 'The speaker may later show this feedback, anonymized, to a reviewer of a newer version.',
        timeout: 8000,
      })
    } catch {
      toastManager.add({ title: 'Could not publish', description: 'Try again.', timeout: 4000 })
    }
  }

  const handleClear = async () => {
    if (Object.keys(pendingWorkRef.current).length > 0 || !data || !writable) return
    try {
      await clearAnnotations({ speechId, reviewId }).unwrap()
      setLiveOverrides({})
    } catch {
      toastManager.add({ title: 'Could not clear notes', description: 'Try again.', timeout: 4000 })
    }
  }

  /**
   * IMPLEMENTATION-PLANS.md §7.2.6's traced bug, this component's own
   * call site: a successful abandon flips this review's status, which
   * makes `useMyReviewForSpeech` return `null` on the next refetch and
   * unmounts `SpeechWatch`'s whole "Your feedback" tab strip — this very
   * component included. Navigating away is not optional cosmetic polish
   * here; staying put would mean this component keeps rendering (with
   * now-stale props) for a split second and then the PARENT unmounts it
   * out from under whatever it was mid-render-cycle doing. `speechId` is
   * already a prop — no extra plumbing needed to reach the mutation's
   * cross-slice `Speech`-tag invalidation.
   */
  const handleAbandon = async () => {
    if (Object.keys(pendingWorkRef.current).length > 0 || !data || !writable) return
    try {
      await abandonReview({ id: reviewId, speechId }).unwrap()
      navigate('/dashboard')
    } catch {
      toastManager.add({ title: 'Could not abandon this review', description: 'Try again.', timeout: 4000 })
    }
  }

  // IMPLEMENTATION-PLANS.md §7.7.6: the reviewer-authoring half of the
  // keyboard map. `merged`, not `serverRows` — §7.7.6's `[`/`]` seek
  // relative to the playhead within the SAME set the live preview shows,
  // drafts included, same reasoning as every other call site in this
  // component that reads `merged` rather than re-deriving its own ordering.
  useKeyboardShortcuts({
    videoEl,
    annotations: merged,
    onSeek,
    setToPlayhead: composerSetToPlayhead,
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Your commentary</CardTitle>
          <CardDescription>Choose Start and End, enter commentary, then add the annotation. Publish when your feedback is ready.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isError && <div role="alert" className="text-sm">Could not refresh your feedback. Your draft is retained. <Button type="button" variant="outline" onClick={() => void refetch()}>Retry loading notes</Button></div>}
        {legacyConflict && <p role="status" className="text-sm text-muted-foreground">Some older feedback overlaps or has unclassified timing. You can read, edit its text and publish it. New or moved annotations must use a free segment.</p>}
        <div className="pointer-events-none relative flex min-h-16 flex-col justify-end">
          <OverlayStack annotations={merged} activeIds={activeIds} currentTime={currentTime} draftIds={draftIds} />
        </div>

        <TimelineStrip
          annotations={merged}
          speechId={speechId}
          reviewId={reviewId}
          videoEl={videoEl}
          durationSeconds={durationSeconds}
          onSeek={onSeek}
        />

        <Composer
          speechId={speechId}
          reviewId={reviewId}
          videoEl={videoEl}
          userId={userId}
          durationMs={durationMs}
          annotations={data?.annotations}
          writable={writable}
          onPendingChange={handlePendingChange}
          onLiveChange={handleLiveChange}
          onLiveRemove={handleLiveRemove}
          onEditorReady={handleComposerEditorReady}
        />

        {canRecordVoice && (
          <VoiceRecorder speechId={speechId} reviewId={reviewId} videoEl={videoEl} durationMs={durationMs} annotations={data?.annotations} writable={writable} onPendingChange={handlePendingChange} />
        )}

        {voiceRows.length > 6 && (
          <p role="status" className="text-sm text-muted-foreground">
            This review has {voiceRows.length} voice notes adding about {Math.ceil(voiceDuration)} seconds of interruptions.
          </p>
        )}

        {/* IMPLEMENTATION-PLANS.md §7.7.1: DECIDED — this list is the
            coach-side AUTHORITATIVE ACCESSIBLE SURFACE for the authoring
            screen (§8.6's "always available, <ol>, chronological,
            timecoded, aria-current on the playing row, click-to-seek"),
            not a gap where a second `Transcript` instance belongs.
            `Transcript.tsx`'s own `<ol aria-label="Commentary
            transcript">` is the SPEAKER-side surface (mounted via
            `TrackSelector`, inside `SpeechWatch.tsx`'s owner-only branch)
            and intentionally has no coach-side counterpart here — adding
            one would duplicate the coach's own notes into two lists on one
            screen and collide with that same `aria-label` under
            Playwright's strict mode. The "always available" property
            depends on the `keepMounted` added to this panel's `TabsPanel`
            in `SpeechWatch.tsx` (Base UI unmounts an inactive panel, and
            `AnnotationList`, by default) — without it this list, like
            `Transcript`'s, is removed from the DOM the instant the coach
            switches to Essay or Transcript. */}
        <AnnotationList
          annotations={serverRows}
          speechId={speechId}
          reviewId={reviewId}
          videoEl={videoEl}
          userId={userId}
          durationMs={durationMs}
          onPendingChange={handlePendingChange}
          currentId={currentId}
          onSeek={onSeek}
          onLiveChange={handleLiveChange}
          onLiveRemove={handleLiveRemove}
        />

        <RemovedAnnotationDrafts userId={userId} speechId={speechId} reviewId={reviewId} annotations={data?.annotations} />

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <ClearAnnotationsDialog
              isPublished={review.first_published_at !== null}
              isClearing={isClearing}
              disabled={pending || isPublishing || isAbandoning || !data || !writable}
              onConfirm={handleClear}
            />
            {/* IMPLEMENTATION-PLANS.md §7.2.4/§7.2.6: Abandon lives here
                too, not only on the Dashboard — a reviewer who's already
                mid-session with the speech open has no reason to leave
                this page just to stop reviewing it. Grouped with Clear,
                the other terminal/destructive action in this footer,
                rather than next to Publish.

                code-review finding: this used to render unconditionally.
                `useMyReviewForSpeech`'s ACCESS_GRANTING set (and so this
                whole panel) includes `published`, but
                `ReviewPolicy::abandon`/`ReviewService::abandon` only ever
                act on `accepted`/`in_progress` — a published review's
                Abandon button was permanently dead, 403ing on every click
                with no path to success. Gated the same way Dashboard's
                equivalent button already is. */}
            {['accepted', 'in_progress'].includes(review.status) && (
              <Button
                type="button"
                variant="destructive"
                disabled={pending || isAbandoning || isClearing || isPublishing || !data || !writable}
                onClick={() => void handleAbandon()}
              >
                {isAbandoning ? 'Abandoning…' : 'Abandon'}
              </Button>
            )}
          </div>
          <Button type="button" onClick={() => void handlePublish()} disabled={pending || isPublishing || isClearing || isAbandoning || !data || !writable}>
            {isPublishing ? 'Publishing…' : 'Publish feedback'}
          </Button>
        </div>
        {pending && <p role="status" className="text-sm text-muted-foreground">Add, save, or discard your pending feedback before publishing, clearing notes or abandoning this review.</p>}
        {blocker.state === 'blocked' && <div role="dialog" aria-modal="true" aria-label="Unsaved feedback" className="space-y-2 rounded border border-border p-3">
          <p>You have pending feedback. Keep editing to save it. Text drafts are kept locally when storage is available; unsaved recordings will be lost if you leave.</p>
          <Button type="button" onClick={() => blocker.reset()}>Keep editing</Button>{' '}
          <Button type="button" variant="outline" onClick={() => blocker.proceed()}>Leave page</Button>
        </div>}
      </CardContent>
    </Card>
  )
}
