import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  useLazyGetVoiceAudioUrlQuery,
  useRetryVoiceTranscriptMutation,
  useUpdateAnnotationMutation,
} from '@/features/annotation/annotationApi'
import {
  annotationDisplayBody,
  isAnnotationConflict,
  type Annotation,
} from '@/features/annotation/types'
import { formatSpokenTimecode, formatTimecode } from '@/lib/time'

export function VoiceAnnotationRow({
  annotation,
  speechId,
  reviewId,
  isCurrent,
  onSeek,
  onDelete,
}: {
  annotation: Annotation
  speechId: number
  reviewId: number
  isCurrent: boolean
  onSeek: (seconds: number) => void
  onDelete: (annotation: Annotation) => Promise<void>
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [editingTranscript, setEditingTranscript] = useState(false)
  const [transcript, setTranscript] = useState(annotation.body)
  const [transcriptLockVersion, setTranscriptLockVersion] = useState(annotation.lock_version)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const lastAppliedServerTranscriptRef = useRef({ body: annotation.body, lockVersion: annotation.lock_version })
  const [loadAudio, { isFetching }] = useLazyGetVoiceAudioUrlQuery()
  const [retryTranscript, { isLoading: isRetrying }] = useRetryVoiceTranscriptMutation()
  const [updateAnnotation, { isLoading: isSaving }] = useUpdateAnnotationMutation()

  useEffect(() => {
    const last = lastAppliedServerTranscriptRef.current
    if (editingTranscript || (last.body === annotation.body && last.lockVersion === annotation.lock_version)) return
    setTranscript(annotation.body)
    setTranscriptLockVersion(annotation.lock_version)
    lastAppliedServerTranscriptRef.current = { body: annotation.body, lockVersion: annotation.lock_version }
  }, [annotation.body, annotation.lock_version, editingTranscript])

  const saveTranscript = async () => {
    setTranscriptError(null)
    try {
      const response = await updateAnnotation({
        speechId,
        reviewId,
        annotationId: annotation.id,
        body: { lock_version: transcriptLockVersion, body: transcript },
      }).unwrap()
      setTranscript(response.body)
      setTranscriptLockVersion(response.lock_version)
      setEditingTranscript(false)
    } catch (error) {
      const data = (error as { data?: unknown })?.data
      if (isAnnotationConflict(data)) {
        setTranscriptLockVersion(data.current.lock_version)
        setTranscriptError('This transcript changed elsewhere. Your text is still here; review it and save again.')
      } else {
        setTranscriptError('Could not save transcript. Try again.')
      }
    }
  }

  const preview = async () => {
    if (audioUrl) return
    try {
      const response = await loadAudio({ speechId, annotationId: annotation.id }, true).unwrap()
      setAudioUrl(response.audio.url)
    } catch {
      setAudioUrl(null)
    }
  }

  return (
    <li aria-current={isCurrent ? 'true' : undefined} className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="min-h-11 text-left text-sm font-medium" onClick={() => onSeek(annotation.start_seconds)}>
          <span aria-hidden="true">🔊 {formatTimecode(annotation.start_seconds)}</span>
          <span className="sr-only">Voice note at {formatSpokenTimecode(annotation.start_seconds)}</span>
        </button>
        <div className="flex flex-wrap gap-2">
          {annotation.voice?.audio_status === 'ready' && (
            <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={isFetching} onClick={() => void preview()}>
              {isFetching ? 'Loading…' : 'Preview audio'}
            </Button>
          )}
          {annotation.voice?.transcript_status === 'failed' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11"
              disabled={isRetrying}
              onClick={() => void retryTranscript({ speechId, reviewId, annotationId: annotation.id })}
            >
              {isRetrying ? 'Retrying…' : 'Retry transcript'}
            </Button>
          )}
          {annotation.voice?.transcript_status === 'ready' && (
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setEditingTranscript((open) => !open)}>
              {editingTranscript ? 'Close transcript editor' : 'Edit transcript'}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void onDelete(annotation)}>
            Delete
          </Button>
        </div>
      </div>
      {audioUrl && (
        <audio
          controls
          preload="metadata"
          className="w-full"
          src={audioUrl}
          aria-label="Voice note audio"
          // The fetched URL is a presigned link with a fixed TTL
          // (MediaUrlSigner::DEFAULT_TTL_SECONDS, 600s) — preview()
          // otherwise no-ops forever once audioUrl is set
          // (`if (audioUrl) return`), so a session left open past that
          // TTL got a silent, unrecoverable playback failure with no way
          // to retry. Clearing audioUrl on error lets a re-click of
          // "Preview audio" fetch a fresh signed URL instead.
          onError={() => setAudioUrl(null)}
        />
      )}
      {annotation.voice?.audio_status === 'processing' && <p role="status">Preparing audio…</p>}
      {annotation.voice?.audio_status === 'failed' && <p role="alert">Voice audio unavailable.</p>}
      {editingTranscript ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor={`voice-transcript-${annotation.id}`}>Transcript</label>
          <textarea
            id={`voice-transcript-${annotation.id}`}
            className="min-h-24 w-full rounded-md border border-input bg-background p-2 text-base"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
          />
          {transcriptError && <p role="alert" className="text-sm text-[var(--color-danger)]">{transcriptError}</p>}
          <Button type="button" size="sm" disabled={isSaving || transcript.trim() === ''} onClick={() => void saveTranscript()}>
            {isSaving ? 'Saving…' : 'Save transcript'}
          </Button>
        </div>
      ) : (
        <p className="text-sm">{annotationDisplayBody(annotation)}</p>
      )}
    </li>
  )
}
