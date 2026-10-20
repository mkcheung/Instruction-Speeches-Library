import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AnnotationEditor } from '@/components/annotation/AnnotationEditor'
import { useAnnotationEditor } from '@/hooks/useAnnotationEditor'
import { useLazyGetVoiceAudioUrlQuery, useRetryVoiceTranscriptMutation } from '@/features/annotation/annotationApi'
import { annotationDisplayBody, type Annotation } from '@/features/annotation/types'
import { formatSpokenTimecode } from '@/lib/time'
import { formatAnnotationTime } from '@/lib/annotationTiming'

/** Audio controls are independent of the shared, recoverable body-only editor. */
export function VoiceAnnotationRow({ annotation, speechId, reviewId, userId, isCurrent, onSeek, onDelete, onPendingChange }: {
  annotation: Annotation
  speechId: number
  reviewId: number
  userId?: string
  isCurrent: boolean
  onSeek: (seconds: number) => void
  onDelete: (annotation: Annotation) => Promise<void>
  onPendingChange?: (id: string, pending: boolean) => void
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [acknowledged, setAcknowledged] = useState<Annotation | null>(null)
  const effective = acknowledged && acknowledged.lock_version > annotation.lock_version ? acknowledged : annotation
  const [loadAudio, { isFetching }] = useLazyGetVoiceAudioUrlQuery()
  const [retryTranscript, { isLoading: isRetrying }] = useRetryVoiceTranscriptMutation()
  useEffect(() => { onPendingChange?.(`transcript-retry-${annotation.id}`, isRetrying) }, [onPendingChange, annotation.id, isRetrying])
  useEffect(() => () => { onPendingChange?.(`transcript-retry-${annotation.id}`, false) }, [onPendingChange, annotation.id])
  const preview = async () => {
    if (audioUrl) return
    try { setAudioUrl((await loadAudio({ speechId, annotationId: annotation.id }, true).unwrap()).audio.url) }
    catch { setAudioUrl(null) }
  }
  return <li aria-current={isCurrent ? 'true' : undefined} className="space-y-2 rounded-md border border-border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" className="min-h-11 text-left text-sm font-medium" onClick={() => onSeek(effective.start_seconds)}>
        <span aria-hidden="true">🔊 {formatAnnotationTime(Math.round(effective.start_seconds * 1000))}</span>
        <span className="sr-only">Voice note at {formatSpokenTimecode(effective.start_seconds)}</span>
      </button>
      <div className="flex flex-wrap gap-2">
        {effective.voice?.audio_status === 'ready' && <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={isFetching} onClick={() => void preview()}>{isFetching ? 'Loading…' : 'Preview audio'}</Button>}
        {effective.voice?.transcript_status === 'failed' && <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={isRetrying || editing} onClick={() => void retryTranscript({ speechId, reviewId, annotationId: annotation.id })}>{isRetrying ? 'Retrying…' : 'Retry transcript'}</Button>}
        {effective.voice?.transcript_status === 'ready' && !editing && <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setEditing(true)}>Edit transcript</Button>}
        <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={editing || isRetrying} onClick={() => void onDelete(effective)}>Delete</Button>
      </div>
    </div>
    {audioUrl && <audio controls preload="metadata" className="w-full" src={audioUrl} aria-label="Voice note audio" onError={() => setAudioUrl(null)} />}
    {effective.voice?.audio_status === 'processing' && <p role="status">Preparing audio…</p>}
    {effective.voice?.audio_status === 'failed' && <p role="alert">Voice audio unavailable.</p>}
    {editing ? <TranscriptEditor annotation={effective} speechId={speechId} reviewId={reviewId} userId={userId} onPendingChange={onPendingChange}
      onCancel={() => setEditing(false)} onSaved={(saved) => { setAcknowledged(saved); setEditing(false) }} />
      : <p className="text-sm">{annotationDisplayBody(effective)}</p>}
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
