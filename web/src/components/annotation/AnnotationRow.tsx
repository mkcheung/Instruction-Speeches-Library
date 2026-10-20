import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AnnotationEditor } from '@/components/annotation/AnnotationEditor'
import { useAnnotationEditor, type UseAnnotationEditorOptions } from '@/hooks/useAnnotationEditor'
import { formatSpokenTimecode } from '@/lib/time'
import { formatAnnotationTime } from '@/lib/annotationTiming'
import { isPointAnnotation, type Annotation } from '@/features/annotation/types'
import { cn } from '@/lib/utils'

type RowProps = Omit<UseAnnotationEditorOptions, 'initial'> & {
  annotation: Annotation
  isCurrent: boolean
  onSeek: (seconds: number) => void
  onDelete: (annotation: Annotation) => void
}

export function AnnotationRow({ annotation, isCurrent, onSeek, onDelete, ...editorOptions }: RowProps) {
  const [isOpen, setIsOpen] = useState(false)
  const point = isPointAnnotation(annotation)
  const startMs = Math.round(annotation.start_seconds * 1000)
  return <li aria-current={isCurrent ? 'true' : undefined} className={cn('rounded-lg border border-border p-2', isCurrent && 'border-primary')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" onClick={() => onSeek(annotation.start_seconds)} className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2 text-left text-sm">
        <span className="shrink-0 tabular-nums text-muted-foreground">{formatAnnotationTime(startMs)}{!point && `–${formatAnnotationTime(startMs + Math.round(annotation.duration_seconds * 1000))}`}</span>
        <span className="sr-only">{point ? 'Voice note' : 'Annotation'} at {formatSpokenTimecode(annotation.start_seconds)}</span>
        <span className="truncate">{annotation.body}</span>
      </button>
      {!isOpen && <div className="flex gap-1">
        <Button type="button" size="xs" variant="outline" onClick={() => setIsOpen(true)}>{point ? 'Edit transcript' : 'Edit'}</Button>
        <Button type="button" size="xs" variant="destructive" onClick={() => onDelete(annotation)} aria-label={`Delete annotation at ${formatSpokenTimecode(annotation.start_seconds)}`}>Delete</Button>
      </div>}
    </div>
    {point && <p className="text-xs text-muted-foreground">Voice audio unavailable. This transcript stays at its original position.</p>}
    {isOpen && <div className="mt-2"><RowEditor {...editorOptions} annotation={annotation} onClose={() => setIsOpen(false)} /></div>}
  </li>
}
function RowEditor({ annotation, onClose, ...options }: Omit<RowProps, 'isCurrent' | 'onSeek' | 'onDelete'> & { onClose: () => void }) {
  const editor = useAnnotationEditor({ ...options, initial: annotation, onCancel: onClose,
    onSaved: (saved) => { options.onSaved?.(saved); onClose() } })
  return <AnnotationEditor editor={editor} label={editor.point ? 'Editing transcript' : 'Editing annotation'} existing autoFocus />
}
