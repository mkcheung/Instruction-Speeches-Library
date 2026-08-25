import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { OverlayStack } from '@/components/annotation/OverlayStack'
import { TimelineStrip } from '@/components/annotation/TimelineStrip'
import { Composer } from '@/components/annotation/Composer'
import { VoiceRecorder } from '@/components/annotation/VoiceRecorder'
import { AnnotationList } from '@/components/annotation/AnnotationList'
import { ClearAnnotationsDialog } from '@/components/annotation/ClearAnnotationsDialog'
import { ToastProvider, Toaster, useToastManager } from '@/components/ui/toast'
import { useGetAnnotationsQuery, useClearAnnotationsMutation } from '@/features/annotation/annotationApi'
import { usePublishReviewMutation } from '@/features/review/reviewApi'
import { useTimedAnnotations } from '@/hooks/useTimedAnnotations'
import { useVideoCurrentTime } from '@/hooks/useVideoCurrentTime'
import { useAutoPausePreference } from '@/hooks/useAutoPausePreference'
import { isTmpAnnotationId } from '@/lib/uuid'
import { annotationFieldsEqual } from '@/lib/annotationFields'
import { compareByStartThenId } from '@/lib/annotationOrder'
import type { Annotation } from '@/features/annotation/types'
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
  const { data } = useGetAnnotationsQuery(
    { speechId, reviewId },
    { pollingInterval: 3000, skipPollingIfUnfocused: true },
  )
  const serverRows = useMemo(() => data?.annotations ?? [], [data])

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
  const activeIds = useTimedAnnotations(videoEl, merged)
  const currentTime = useVideoCurrentTime(videoEl)
  const [autoPause, setAutoPause] = useAutoPausePreference(userId)
  const voiceRows = useMemo(() => serverRows.filter((row) => row.voice !== null), [serverRows])
  const voiceDuration = useMemo(
    () => voiceRows.reduce((total, row) => total + row.duration_seconds, 0),
    [voiceRows],
  )

  const [clearAnnotations, { isLoading: isClearing }] = useClearAnnotationsMutation()
  const [publishReview, { isLoading: isPublishing }] = usePublishReviewMutation()
  const toastManager = useToastManager()

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
    try {
      await clearAnnotations({ speechId, reviewId }).unwrap()
      setLiveOverrides({})
    } catch {
      toastManager.add({ title: 'Could not clear notes', description: 'Try again.', timeout: 4000 })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Your commentary</CardTitle>
          <CardDescription>Watch, type at a timestamp, nudge it, publish when ready.</CardDescription>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border border-input"
            checked={autoPause}
            onChange={(e) => setAutoPause(e.target.checked)}
          />
          Pause on first keystroke
        </label>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
          onLiveRetime={handleLiveChange}
          onRetimeError={(message) => toastManager.add({ title: message, timeout: 4000 })}
        />

        <Composer
          speechId={speechId}
          reviewId={reviewId}
          videoEl={videoEl}
          autoPause={autoPause}
          onLiveChange={handleLiveChange}
          onLiveRemove={handleLiveRemove}
        />

        {canRecordVoice && (
          <VoiceRecorder speechId={speechId} reviewId={reviewId} videoEl={videoEl} />
        )}

        {voiceRows.length > 6 && (
          <p role="status" className="text-sm text-muted-foreground">
            This review has {voiceRows.length} voice notes adding about {Math.ceil(voiceDuration)} seconds of interruptions.
          </p>
        )}

        <AnnotationList
          annotations={serverRows}
          speechId={speechId}
          reviewId={reviewId}
          videoEl={videoEl}
          autoPause={autoPause}
          currentId={currentId}
          onSeek={onSeek}
          onLiveChange={handleLiveChange}
          onLiveRemove={handleLiveRemove}
        />

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <ClearAnnotationsDialog
            isPublished={review.first_published_at !== null}
            isClearing={isClearing}
            onConfirm={handleClear}
          />
          <Button type="button" onClick={() => void handlePublish()} disabled={isPublishing}>
            {isPublishing ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
