import { useMemo } from 'react'
import { usePlayheadPercent } from '@/hooks/usePlayheadPercent'
import { formatSpokenTimecode } from '@/lib/time'
import { isPointAnnotation, type Annotation } from '@/features/annotation/types'
import { compareByStartThenId } from '@/lib/annotationOrder'
import { Volume2 } from 'lucide-react'

/** Occupancy and selection are display/seek only. All timing writes use Save. */
export function TimelineStrip({ annotations, videoEl, durationSeconds, onSeek }: {
  annotations: readonly Annotation[]
  speechId?: number
  reviewId?: number
  videoEl: HTMLVideoElement | null
  durationSeconds: number
  onSeek: (seconds: number) => void
  /** Legacy call sites may pass these during a coordinated UI refresh; unused. */
  onLiveRetime?: (live: Annotation) => void
  onRetimeError?: (message: string) => void
}) {
  const setPlayheadNode = usePlayheadPercent(videoEl)
  const laid = useMemo(() => {
    const rowEnds = [-Infinity, -Infinity]
    return [...annotations].sort(compareByStartThenId).map((annotation) => {
      let row = rowEnds.findIndex((end) => end <= annotation.start_seconds)
      if (row < 0) row = rowEnds.indexOf(Math.min(...rowEnds))
      rowEnds[row] = annotation.start_seconds + (isPointAnnotation(annotation) ? 0 : annotation.duration_seconds)
      return { annotation, row }
    })
  }, [annotations])
  const rowCount = Math.max(1, ...laid.map(({ row }) => row + 1))
  return <div ref={setPlayheadNode} className="annotation-timeline rounded-md border border-border bg-muted/30"
    style={{ height: `${rowCount * 1.5}rem` }} data-testid="timeline-strip" aria-label="Annotation timeline">
    <div className="annotation-timeline__playhead" data-testid="timeline-playhead" />
    {laid.map(({ annotation, row }) => {
      const point = isPointAnnotation(annotation)
      const left = durationSeconds > 0 ? annotation.start_seconds / durationSeconds * 100 : 0
      const width = durationSeconds > 0 ? annotation.duration_seconds / durationSeconds * 100 : 0
      return <button key={annotation.id} type="button" onClick={() => onSeek(annotation.start_seconds)}
        aria-label={`${point ? 'Voice note' : 'Annotation'} at ${formatSpokenTimecode(annotation.start_seconds)}`}
        className={point ? 'absolute flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-primary bg-background text-primary'
          : 'absolute h-5 rounded-sm border border-primary bg-primary/30'}
        style={{ top: `${row * 1.5}rem`, left: `${left}%`, ...(point ? {} : { width: `${Math.max(width, 0.5)}%` }) }}
        data-testid={point ? `voice-marker-${annotation.id}` : `range-marker-${annotation.id}`}>
        {point && <Volume2 className="size-3.5" aria-hidden="true" />}
      </button>
    })}
  </div>
}
