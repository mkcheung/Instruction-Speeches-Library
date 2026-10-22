import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AnnotationEditor } from '@/components/annotation/AnnotationEditor'
import { useAnnotationEditor, type UseAnnotationEditorOptions } from '@/hooks/useAnnotationEditor'
import { formatSpokenTimecode } from '@/lib/time'
import { formatAnnotationTime } from '@/lib/annotationTiming'
import { isPointAnnotation, type Annotation } from '@/features/annotation/types'
import { cn } from '@/lib/utils'

const EXCERPT_LENGTH = 120

/**
 * Props shared with `VoiceAnnotationRow`. Everything beyond `annotation`,
 * `isCurrent`, `onSeek` and `onDelete` is optional so the row still works
 * standalone (own details state, no edit lock).
 */
export interface SavedRowProps {
  annotation: Annotation
  isCurrent: boolean
  /** Explicit (marker / Show selected note) selection styling, independent of playback `isCurrent`. */
  isSelected?: boolean
  /** Controlled details disclosure; omit to let the row own it. */
  expanded?: boolean
  onExpandedChange?: (id: string, expanded: boolean) => void
  onSeek: (seconds: number) => void
  onDelete: (annotation: Annotation) => void | Promise<void>
  /** Some other editor or operation holds the list: opening an editor here is disabled. */
  editBlocked?: boolean
  /** A delete / Undo / transcript retry for this row is in flight. */
  busy?: boolean
  /** This row is held for editing but the latest server data no longer contains it. */
  unavailable?: boolean
  /** Stable edit-open reporting: true when an editor mounts, false when it closes or the row unmounts. */
  onEditingChange?: (id: string, editing: boolean) => void
  /** Registers the details toggle (the row's focus target) with the list owner. */
  registerSummary?: (id: string, element: HTMLButtonElement | null) => void
  /** Chronological position among ALL saved notes; omitted while a page is held. */
  position?: { index: number; total: number }
}

type RowProps = Omit<UseAnnotationEditorOptions, 'initial'> & SavedRowProps

/** Bounded plain-text excerpt for the compact summary. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat
}

/** Tracks whether this row's editor is open and reports it exactly once per change (and on unmount). */
function useEditingReport(id: string, onEditingChange?: (id: string, editing: boolean) => void) {
  const [editing, setEditingState] = useState(false)
  const callback = useRef(onEditingChange)
  const editingRef = useRef(false)
  useEffect(() => { callback.current = onEditingChange })
  useEffect(() => () => { if (editingRef.current) callback.current?.(id, false) }, [id])
  const setEditing = useCallback((value: boolean) => {
    editingRef.current = value
    setEditingState(value)
    callback.current?.(id, value)
  }, [id])
  return [editing, setEditing] as const
}

export function AnnotationRow({ annotation, isCurrent, isSelected = false, expanded, onExpandedChange, onSeek, onDelete,
  editBlocked = false, busy = false, unavailable = false, onEditingChange, registerSummary, position, ...editorOptions }: RowProps) {
  const detailsId = useId()
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const restoreFocus = useRef(false)
  const [localExpanded, setLocalExpanded] = useState(false)
  const [editing, setEditing] = useEditingReport(annotation.id, onEditingChange)
  const point = isPointAnnotation(annotation)
  const isExpanded = (expanded ?? localExpanded) || editing
  const setExpanded = (value: boolean) => { setLocalExpanded(value); onExpandedChange?.(annotation.id, value) }
  const startMs = Math.round(annotation.start_seconds * 1000)
  const time = `${formatAnnotationTime(startMs)}${point ? '' : `–${formatAnnotationTime(startMs + Math.round(annotation.duration_seconds * 1000))}`}`
  const noun = point ? 'voice note' : 'annotation'
  const spoken = `${noun} at ${formatSpokenTimecode(annotation.start_seconds)}`
  const closeEditor = () => { restoreFocus.current = true; setEditing(false) }
  useEffect(() => {
    if (editing || !restoreFocus.current) return
    restoreFocus.current = false
    toggleRef.current?.focus()
  }, [editing])
  const setToggle = (element: HTMLButtonElement | null) => { toggleRef.current = element; registerSummary?.(annotation.id, element) }
  return <li tabIndex={-1} data-annotation-id={annotation.id} data-selected={isSelected ? 'true' : undefined} aria-current={isCurrent ? 'true' : undefined}
    aria-posinset={position ? position.index + 1 : undefined} aria-setsize={position?.total}
    className={cn('rounded-lg border border-border p-2', isCurrent && 'border-primary', isSelected && 'ring-2 ring-ring')}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{point ? 'Voice note · Audio unavailable' : 'Text note'}</span>
          <span className="tabular-nums text-muted-foreground">{time}</span>
        </p>
        <p className="break-words">{excerpt(annotation.body)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="min-h-11 min-w-11" aria-label={`Go to time, ${spoken}`} onClick={() => onSeek(annotation.start_seconds)}>Go to time</Button>
        <Button ref={setToggle} type="button" size="sm" variant="outline" className="min-h-11 min-w-11" aria-expanded={isExpanded} aria-controls={detailsId}
          disabled={editing || busy} aria-label={`${isExpanded ? 'Hide' : 'Show'} details, ${spoken}`} onClick={() => setExpanded(!isExpanded)}>{isExpanded ? 'Hide details' : 'Show details'}</Button>
        {!editing && <Button type="button" size="sm" variant="outline" className="min-h-11 min-w-11" disabled={editBlocked || busy || unavailable}
          aria-label={`${point ? 'Edit transcript' : 'Edit'}, ${spoken}`} onClick={() => { setExpanded(true); setEditing(true) }}>{point ? 'Edit transcript' : 'Edit'}</Button>}
      </div>
    </div>
    <div id={detailsId} hidden={!isExpanded} className="mt-2 space-y-2">
      {isExpanded && <>
        {!editing && <p className="whitespace-pre-wrap break-words text-sm">{annotation.body}</p>}
        {point && <p className="text-xs text-muted-foreground">Voice audio unavailable. This transcript stays at its original position.</p>}
        {unavailable && <p role="status" className="text-xs text-muted-foreground">This note is no longer saved on the server. Your local edit is kept here; saving may fail.</p>}
        {busy && <p role="status" className="text-xs text-muted-foreground">Working on this note…</p>}
        {editing && <RowEditor {...editorOptions} annotation={annotation} onClose={closeEditor} />}
        {!editing && !unavailable && <Button type="button" size="sm" variant="destructive" className="min-h-11" disabled={busy}
          onClick={() => void onDelete(annotation)} aria-label={`Delete ${spoken}`}>Delete</Button>}
      </>}
    </div>
  </li>
}
function RowEditor({ annotation, onClose, ...options }: Omit<UseAnnotationEditorOptions, 'initial'> & { annotation: Annotation; onClose: () => void }) {
  const editor = useAnnotationEditor({ ...options, initial: annotation, onCancel: onClose,
    onSaved: (saved) => { options.onSaved?.(saved); onClose() } })
  return <AnnotationEditor editor={editor} label={editor.point ? 'Editing transcript' : 'Editing annotation'} existing autoFocus />
}
