import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AnnotationEditor } from '@/components/annotation/AnnotationEditor'
import type { SavedRowProps } from '@/components/annotation/AnnotationRow'
import { useAnnotationEditor } from '@/hooks/useAnnotationEditor'
import { useLazyGetVoiceAudioUrlQuery, useRetryVoiceTranscriptMutation } from '@/features/annotation/annotationApi'
import { annotationDisplayBody, type Annotation } from '@/features/annotation/types'
import { formatSpokenTimecode } from '@/lib/time'
import { formatAnnotationTime } from '@/lib/annotationTiming'
import { cn } from '@/lib/utils'

const EXCERPT_LENGTH = 120

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat
}
function pauseSafely(element: HTMLAudioElement | null) {
  try { element?.pause() } catch { /* media pause is best effort */ }
}

/**
 * Stable renderer for every point-family row (voice notes and erased-audio points).
 * Audio controls are independent of the shared, recoverable body-only editor. Audio
 * AVAILABILITY always comes from the latest server row (`annotation`); the locally
 * acknowledged saved object may only supply a newer body/lock version.
 */
export function VoiceAnnotationRow({ annotation, speechId, reviewId, userId, isCurrent, isSelected = false, expanded, onExpandedChange,
  onSeek, onDelete, editBlocked = false, busy = false, unavailable = false, onEditingChange, registerSummary, position,
  onPendingChange, audioActive = true }: SavedRowProps & {
  speechId: number
  reviewId: number
  userId?: string
  /** False while the list is folded, paged away from, or outer Notes is hidden: audio is paused and not mounted. */
  audioActive?: boolean
  onPendingChange?: (id: string, pending: boolean) => void
}) {
  const detailsId = useId()
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const restoreFocus = useRef(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [localExpanded, setLocalExpanded] = useState(false)
  const [editing, setEditingState] = useState(false)
  const [acknowledged, setAcknowledged] = useState<Annotation | null>(null)
  const editingRef = useRef(false)
  const reportEditing = useRef(onEditingChange)
  useEffect(() => { reportEditing.current = onEditingChange })
  const id = annotation.id
  useEffect(() => () => { if (editingRef.current) reportEditing.current?.(id, false) }, [id])
  const setEditing = useCallback((value: boolean) => {
    editingRef.current = value
    setEditingState(value)
    reportEditing.current?.(id, value)
  }, [id])
  // Never let an acknowledged object revive audio the latest row no longer has.
  const effective: Annotation = acknowledged && acknowledged.lock_version > annotation.lock_version
    ? { ...annotation, body: acknowledged.body, lock_version: acknowledged.lock_version } : annotation
  const voice = annotation.voice
  if (voice === null && audioUrl !== null) setAudioUrl(null)
  const [loadAudio, { isFetching }] = useLazyGetVoiceAudioUrlQuery()
  const [retryTranscript, { isLoading: isRetrying }] = useRetryVoiceTranscriptMutation()
  useEffect(() => { onPendingChange?.(`transcript-retry-${annotation.id}`, isRetrying) }, [onPendingChange, annotation.id, isRetrying])
  useEffect(() => () => { onPendingChange?.(`transcript-retry-${annotation.id}`, false) }, [onPendingChange, annotation.id])
  const isExpanded = (expanded ?? localExpanded) || editing
  const setExpanded = (value: boolean) => { setLocalExpanded(value); onExpandedChange?.(annotation.id, value) }
  const showAudio = isExpanded && audioActive && audioUrl !== null && voice !== null
  useEffect(() => {
    const element = audioRef.current
    if (element && !audioActive) pauseSafely(element)
    return () => pauseSafely(element)
  }, [audioActive, showAudio])
  useEffect(() => {
    if (editing || !restoreFocus.current) return
    restoreFocus.current = false
    toggleRef.current?.focus()
  }, [editing])
  const preview = async () => {
    setExpanded(true)
    if (audioUrl || voice === null) return
    try { setAudioUrl((await loadAudio({ speechId, annotationId: annotation.id }, true).unwrap()).audio.url) }
    catch { setAudioUrl(null) }
  }
  const setToggle = (element: HTMLButtonElement | null) => { toggleRef.current = element; registerSummary?.(annotation.id, element) }
  const spoken = `voice note at ${formatSpokenTimecode(effective.start_seconds)}`
  const canEditTranscript = !editing && (voice === null || voice.transcript_status === 'ready')
  const length = voice !== null && effective.duration_seconds > 0 ? `${Math.round(effective.duration_seconds * 10) / 10} s recording` : null
  const closeEditor = () => { restoreFocus.current = true; setEditing(false) }
  return <li tabIndex={-1} data-annotation-id={annotation.id} data-selected={isSelected ? 'true' : undefined} aria-current={isCurrent ? 'true' : undefined}
    aria-posinset={position ? position.index + 1 : undefined} aria-setsize={position?.total}
    className={cn('rounded-md border border-border p-2', isCurrent && 'border-primary', isSelected && 'ring-2 ring-ring')}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{voice === null ? 'Voice note · Audio unavailable' : 'Voice note'}</span>
          <span className="tabular-nums text-muted-foreground">{formatAnnotationTime(Math.round(effective.start_seconds * 1000))}</span>
          {length && <span className="text-muted-foreground">{length}</span>}
        </p>
        <p className="break-words">{excerpt(annotationDisplayBody(effective))}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11" aria-label={`Go to time, ${spoken}`} onClick={() => onSeek(effective.start_seconds)}>Go to time</Button>
        <Button ref={setToggle} type="button" variant="outline" size="sm" className="min-h-11 min-w-11" aria-expanded={isExpanded} aria-controls={detailsId}
          disabled={editing || busy} aria-label={`${isExpanded ? 'Hide' : 'Show'} details, ${spoken}`} onClick={() => setExpanded(!isExpanded)}>{isExpanded ? 'Hide details' : 'Show details'}</Button>
        {voice?.audio_status === 'ready' && <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11" disabled={isFetching}
          aria-label={`${isFetching ? 'Loading…' : 'Preview audio'}, ${spoken}`} onClick={() => void preview()}>{isFetching ? 'Loading…' : 'Preview audio'}</Button>}
        {canEditTranscript && <Button type="button" variant="outline" size="sm" className="min-h-11 min-w-11" disabled={editBlocked || busy || unavailable}
          aria-label={`Edit transcript, ${spoken}`} onClick={() => { setExpanded(true); setEditing(true) }}>Edit transcript</Button>}
      </div>
    </div>
    <div id={detailsId} hidden={!isExpanded} className="mt-2 space-y-2">
      {isExpanded && <>
        {showAudio && <audio ref={audioRef} controls preload="metadata" className="w-full" src={audioUrl} aria-label="Voice note audio" onError={() => setAudioUrl(null)} />}
        {voice?.audio_status === 'processing' && <p role="status">Preparing audio…</p>}
        {voice?.audio_status === 'failed' && <p role="alert">Voice audio unavailable.</p>}
        {voice === null && <p className="text-xs text-muted-foreground">Voice audio unavailable. This transcript stays at its original position.</p>}
        {unavailable && <p role="status" className="text-xs text-muted-foreground">This note is no longer saved on the server. Your local edit is kept here; saving may fail.</p>}
        {busy && <p role="status" className="text-xs text-muted-foreground">Working on this note…</p>}
        {editing ? <TranscriptEditor annotation={effective} speechId={speechId} reviewId={reviewId} userId={userId} onPendingChange={onPendingChange}
          onCancel={closeEditor} onSaved={(saved) => { setAcknowledged(saved); closeEditor() }} />
          : <p className="whitespace-pre-wrap break-words text-sm">{annotationDisplayBody(effective)}</p>}
        {voice?.transcript_status === 'failed' && <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={isRetrying || editing || busy}
          aria-label={`Retry transcript, ${spoken}`} onClick={() => void retryTranscript({ speechId, reviewId, annotationId: annotation.id })}>{isRetrying ? 'Retrying…' : 'Retry transcript'}</Button>}
        {!unavailable && <Button type="button" variant="destructive" size="sm" className="min-h-11" disabled={editing || isRetrying || busy}
          aria-label={`Delete ${spoken}`} onClick={() => void onDelete(effective)}>Delete</Button>}
      </>}
    </div>
  </li>
}
function TranscriptEditor({ annotation, speechId, reviewId, userId, onPendingChange, onCancel, onSaved }: {
  annotation: Annotation
  speechId: number
  reviewId: number
  userId?: string
  onPendingChange?: (id: string, pending: boolean) => void
  onCancel: () => void
  onSaved: (annotation: Annotation) => void
}) {
  const editor = useAnnotationEditor({ initial: annotation, speechId, reviewId, userId, videoEl: null,
    onPendingChange, onCancel, onSaved })
  return <AnnotationEditor editor={editor} label="Editing transcript" existing autoFocus />
}
