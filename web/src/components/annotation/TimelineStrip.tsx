import { useMemo, useRef } from 'react'
import { usePlayheadPercent } from '@/hooks/usePlayheadPercent'
import { useUpdateAnnotationMutation } from '@/features/annotation/annotationApi'
import { formatSpokenTimecode } from '@/lib/time'
import type { Annotation } from '@/features/annotation/types'
import { isTmpAnnotationId } from '@/lib/uuid'
import { compareByStartThenId } from '@/lib/annotationOrder'
import { cn } from '@/lib/utils'

const MAX_ROWS = 2
/** Two markers within this many seconds of each other are treated as
 * overlapping for staggering purposes — matches the seed fixture's own
 * overlap gap (`annotations:seed`, STEP-06). */
const OVERLAP_EPSILON = 0

interface LaidOutMarker {
  annotation: Annotation
  row: number
}

/** Greedy interval-scheduling layout: markers stagger onto a second row
 * rather than hiding each other (§8.4) — a marker joins the first row
 * whose last-placed item has already ended, capped at `MAX_ROWS` (beyond
 * that, later rows are reused rather than growing without bound). */
function layoutRows(annotations: readonly Annotation[]): LaidOutMarker[] {
  const sorted = [...annotations].sort(compareByStartThenId)
  const rowEnds = new Array<number>(MAX_ROWS).fill(-Infinity)
  const laid: LaidOutMarker[] = []
  for (const a of sorted) {
    let row = rowEnds.findIndex((end) => end <= a.start_seconds + OVERLAP_EPSILON)
    if (row === -1) {
      // Every row is still occupied — reuse whichever row frees up soonest
      // rather than growing past MAX_ROWS.
      row = rowEnds.indexOf(Math.min(...rowEnds))
    }
    rowEnds[row] = a.start_seconds + a.duration_seconds
    laid.push({ annotation: a, row })
  }
  return laid
}

type DragKind = 'start' | 'duration'

/**
 * MODERNIZATION_PLAN.md §8.4: the timeline strip beneath the scrubber —
 * markers are `%`-positioned buttons (zero JS on resize), overlapping
 * markers stagger onto a second row, and the playhead is a CSS custom
 * property driven by rAF (`usePlayheadPercent`), never React state. Drag
 * the left edge to move the start, the right edge to change the duration.
 *
 * Drag-retime calls `updateAnnotation` directly (not through
 * `useAnnotationEditor`) — a marker can be dragged whether or not that
 * row's in-place editor happens to be open. This is a deliberate scope cut
 * from the full three-tier conflict UI: a 409 during a drag surfaces as a
 * plain error via `onRetimeError` rather than the inline banner
 * `AnnotationEditor` shows, since there's no open editor to show it in.
 */
export function TimelineStrip({
  annotations,
  speechId,
  reviewId,
  videoEl,
  durationSeconds,
  onSeek,
  onLiveRetime,
  onRetimeError,
}: {
  annotations: readonly Annotation[]
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
  durationSeconds: number
  onSeek: (seconds: number) => void
  /** Mirrors the same live-override mechanism the composer/row editors use
   * so a drag-in-progress shows up in the preview immediately. */
  onLiveRetime: (live: Annotation) => void
  onRetimeError?: (message: string) => void
}) {
  const setPlayheadNode = usePlayheadPercent(videoEl)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [updateAnnotation] = useUpdateAnnotationMutation()

  const laid = useMemo(() => layoutRows(annotations), [annotations])
  const rowCount = Math.max(1, Math.min(MAX_ROWS, ...laid.map((m) => m.row + 1)))

  const startDrag = (kind: DragKind, annotation: Annotation, startClientX: number) => {
    const container = containerRef.current
    if (!container || durationSeconds <= 0 || isTmpAnnotationId(annotation.id)) return
    const rect = container.getBoundingClientRect()
    const originalStart = annotation.start_seconds
    const originalDuration = annotation.duration_seconds
    let latest = { start_seconds: originalStart, duration_seconds: originalDuration }

    const onMove = (e: PointerEvent) => {
      const deltaPx = e.clientX - startClientX
      const deltaSeconds = (deltaPx / rect.width) * durationSeconds
      if (kind === 'start') {
        const nextStart = Math.max(0, Math.min(originalStart + originalDuration - 0.5, originalStart + deltaSeconds))
        latest = { start_seconds: Math.round(nextStart * 1000) / 1000, duration_seconds: originalDuration }
      } else {
        const nextDuration = Math.max(0.5, Math.min(120, originalDuration + deltaSeconds))
        latest = { start_seconds: originalStart, duration_seconds: Math.round(nextDuration * 1000) / 1000 }
      }
      onLiveRetime({ ...annotation, ...latest })
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }

    const onUp = () => {
      cleanup()
      if (latest.start_seconds === originalStart && latest.duration_seconds === originalDuration) return
      updateAnnotation({
        speechId,
        reviewId,
        annotationId: annotation.id,
        body: { lock_version: annotation.lock_version, ...latest },
      })
        .unwrap()
        .catch(() => onRetimeError?.('Could not save the new timing — try again.'))
    }

    // A cancelled gesture (touch scroll takeover, system UI interrupt)
    // never fires `pointerup` — without this, the `pointermove`/`pointerup`
    // listeners above stay attached to `window` indefinitely, so any later,
    // unrelated pointer movement anywhere on the page keeps calling
    // `onLiveRetime` with this drag's stale closure. No PATCH on cancel —
    // just clean up and restore the live preview to the pre-drag position.
    const onCancel = () => {
      cleanup()
      onLiveRetime({ ...annotation, start_seconds: originalStart, duration_seconds: originalDuration })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onCancel, { once: true })
  }

  return (
    <div
      ref={(node) => {
        containerRef.current = node
        setPlayheadNode(node)
      }}
      className="annotation-timeline rounded-md border border-border bg-muted/30"
      style={{ height: `${rowCount * 1.5}rem` }}
      data-testid="timeline-strip"
    >
      <div className="annotation-timeline__playhead" data-testid="timeline-playhead" />
      {laid.map(({ annotation, row }) => {
        const leftPercent = durationSeconds > 0 ? (annotation.start_seconds / durationSeconds) * 100 : 0
        const widthPercent = durationSeconds > 0 ? (annotation.duration_seconds / durationSeconds) * 100 : 0
        return (
          <div
            key={annotation.id}
            className="absolute flex h-5 items-stretch"
            style={{
              top: `${row * 1.5}rem`,
              left: `${leftPercent}%`,
              width: `${Math.max(widthPercent, 0.5)}%`,
            }}
          >
            <button
              type="button"
              onClick={() => onSeek(annotation.start_seconds)}
              aria-label={`Annotation at ${formatSpokenTimecode(annotation.start_seconds)}`}
              className={cn(
                'relative flex-1 rounded-sm border text-[0px]',
                annotation.kind === 'correction'
                  ? 'border-[var(--color-danger)] bg-[var(--color-danger)]/30'
                  : 'border-primary bg-primary/30',
              )}
            >
              <span
                role="presentation"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  startDrag('start', annotation, e.clientX)
                }}
                className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                data-testid={`marker-${annotation.id}-start-handle`}
              />
              <span
                role="presentation"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  startDrag('duration', annotation, e.clientX)
                }}
                className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                data-testid={`marker-${annotation.id}-duration-handle`}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}
