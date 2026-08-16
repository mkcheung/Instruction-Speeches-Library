import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AnnotationEditor } from '@/components/annotation/AnnotationEditor'
import { useAnnotationEditor } from '@/hooks/useAnnotationEditor'
import { formatSpokenTimecode, formatTimecode } from '@/lib/time'
import type { Annotation } from '@/features/annotation/types'
import { cn } from '@/lib/utils'

/**
 * One row of the linear, readable-without-video list (§8.4/§8.6). Clicking
 * it opens editing controls IN PLACE — a per-row `useAnnotationEditor`
 * instance mounted only while `isOpen`, never the composer's create-form
 * state. This is the direct fix for the named legacy bug
 * (`legacy/editNote.php` loaded a row back into one shared edit form,
 * conflating two drafts).
 */
export function AnnotationRow({
  annotation,
  speechId,
  reviewId,
  videoEl,
  autoPause,
  isCurrent,
  onSeek,
  onDelete,
  onLiveChange,
  onSaved,
  onSilentAdopt,
}: {
  annotation: Annotation
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
  autoPause: boolean
  isCurrent: boolean
  onSeek: (seconds: number) => void
  onDelete: (annotation: Annotation) => void
  onLiveChange: (live: Annotation) => void
  onSaved?: (annotation: Annotation) => void
  onSilentAdopt?: (annotation: Annotation) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <li className={cn('rounded-lg border border-border p-2', isCurrent && 'border-primary')}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onSeek(annotation.start_seconds)}
          className="flex flex-1 items-baseline gap-2 text-left text-sm"
        >
          <span aria-hidden="true" className="shrink-0 tabular-nums text-muted-foreground">
            {formatTimecode(annotation.start_seconds)}
          </span>
          <span className="sr-only">Annotation at {formatSpokenTimecode(annotation.start_seconds)}</span>
          <span className="truncate">{annotation.body}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="xs" variant="outline" onClick={() => setIsOpen((v) => !v)}>
            {isOpen ? 'Close' : 'Edit'}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            onClick={() => onDelete(annotation)}
            aria-label={`Delete annotation at ${formatSpokenTimecode(annotation.start_seconds)}`}
          >
            Delete
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-2">
          <RowEditor
            annotation={annotation}
            speechId={speechId}
            reviewId={reviewId}
            videoEl={videoEl}
            autoPause={autoPause}
            onLiveChange={onLiveChange}
            onSaved={onSaved}
            onSilentAdopt={onSilentAdopt}
          />
        </div>
      )}
    </li>
  )
}

function RowEditor({
  annotation,
  speechId,
  reviewId,
  videoEl,
  autoPause,
  onLiveChange,
  onSaved,
  onSilentAdopt,
}: {
  annotation: Annotation
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
  autoPause: boolean
  onLiveChange: (live: Annotation) => void
  onSaved?: (annotation: Annotation) => void
  onSilentAdopt?: (annotation: Annotation) => void
}) {
  const editor = useAnnotationEditor({
    speechId,
    reviewId,
    // `initial` is read once, at mount — this row's OWN state, seeded from
    // its own data, never the composer's.
    initial: annotation,
    videoEl,
    autoPause,
    onLiveChange,
    onSaved,
    onSilentAdopt,
  })

  return <AnnotationEditor editor={editor} label="Editing note" autoFocus />
}
