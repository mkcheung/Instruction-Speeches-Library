import { useEffect, useRef } from 'react'
import { AnnotationRow } from '@/components/annotation/AnnotationRow'
import { VoiceAnnotationRow } from '@/components/annotation/VoiceAnnotationRow'
import { useToastManager } from '@/components/ui/toast'
import { useCreateAnnotationMutation, useDeleteAnnotationMutation, useRestoreVoiceAnnotationMutation, useRestorePointAnnotationMutation } from '@/features/annotation/annotationApi'
import { isPointAnnotation, type Annotation } from '@/features/annotation/types'
import { formatAnnotationTime } from '@/lib/annotationTiming'
import { compareByStartThenId } from '@/lib/annotationOrder'
import { writeAnnotationRecovery } from '@/lib/annotationRecovery'
import { newClientUuid } from '@/lib/uuid'

const UNDO_TIMEOUT_MS = 6000
export function AnnotationList({ annotations, speechId, reviewId, videoEl, autoPause, currentId, onSeek, onLiveChange,
  onLiveRemove, onSaved, onSilentAdopt, userId, durationMs, onPendingChange }: {
  annotations: readonly Annotation[]
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
  autoPause?: boolean
  userId?: string
  durationMs?: number | null
  currentId: string | null
  onSeek: (seconds: number) => void
  onLiveChange: (live: Annotation) => void
  onLiveRemove: (id: string) => void
  onSaved?: (annotation: Annotation) => void
  onSilentAdopt?: (annotation: Annotation) => void
  onPendingChange?: (id: string, pending: boolean) => void
}) {
  const [deleteAnnotation] = useDeleteAnnotationMutation()
  const [createAnnotation] = useCreateAnnotationMutation()
  const [restoreVoiceAnnotation] = useRestoreVoiceAnnotationMutation()
  const [restorePointAnnotation] = useRestorePointAnnotationMutation()
  const toastManager = useToastManager()
  const operations = useRef(new Set<string>())
  useEffect(() => () => { for (const id of operations.current) onPendingChange?.(id, false) }, [onPendingChange])
  const mark = (id: string, pending: boolean) => {
    if (pending) operations.current.add(id); else operations.current.delete(id)
    onPendingChange?.(id, pending)
  }
  const recoverDeletedText = (annotation: Annotation) => {
    if (!userId || isPointAnnotation(annotation)) return
    writeAnnotationRecovery({ version: 2, scope: { userId, speechId, reviewId, rowId: null }, instanceId: newClientUuid(),
      clientUuid: annotation.client_uuid, revision: 1, updatedAt: Date.now(), lockVersion: 0, uncertain: null,
      fields: { start: formatAnnotationTime(Math.round(annotation.start_seconds * 1000)),
        end: formatAnnotationTime(Math.round(annotation.start_seconds * 1000) + Math.round(annotation.duration_seconds * 1000)), body: annotation.body } })
    window.dispatchEvent(new Event('storage'))
  }
  const handleDelete = async (annotation: Annotation) => {
    const deleteKey = `delete-${annotation.id}`
    if (operations.current.has(deleteKey)) return
    mark(deleteKey, true)
    try {
      await deleteAnnotation({ speechId, reviewId, annotationId: annotation.id }).unwrap()
      onLiveRemove(annotation.id)
      let undoStatus: 'idle' | 'pending' | 'done' = 'idle'
      toastManager.add({ title: isPointAnnotation(annotation) ? 'Voice note deleted' : 'Note deleted', timeout: UNDO_TIMEOUT_MS,
        actionProps: { children: 'Undo', onClick: () => {
          if (undoStatus !== 'idle') return
          undoStatus = 'pending'
          const undoKey = `undo-${annotation.id}`; mark(undoKey, true)
          const request = isPointAnnotation(annotation)
            ? (annotation.voice === null ? restorePointAnnotation : restoreVoiceAnnotation)({ speechId, reviewId, annotationId: annotation.id })
            : createAnnotation({ speechId, reviewId, body: { client_uuid: annotation.client_uuid, body: annotation.body,
              start_seconds: annotation.start_seconds, duration_seconds: annotation.duration_seconds, kind: annotation.kind, topic: annotation.topic } })
          void request.unwrap().then((saved) => { undoStatus = 'done'; onSaved?.(saved) }).catch((error: unknown) => {
            undoStatus = 'idle'; recoverDeletedText(annotation)
            const overlap = (error as { data?: { code?: string } })?.data?.code === 'annotation_overlap'
            toastManager.add({ title: 'Could not undo', description: overlap ? 'That position is now occupied. Your written text is available under Recoverable drafts.' : 'Try again. Written text is retained under Recoverable drafts.', timeout: 8000 })
          }).finally(() => mark(undoKey, false))
        } } })
    } catch {
      toastManager.add({ title: 'Could not delete', description: 'Refresh feedback and try again.', timeout: 4000 })
    } finally { mark(deleteKey, false) }
  }
  return <ol className="flex flex-col gap-2" aria-label="Your commentary">
    {[...annotations].sort(compareByStartThenId).map((annotation) => annotation.voice !== null
      ? <VoiceAnnotationRow key={annotation.id} annotation={annotation} speechId={speechId} reviewId={reviewId} userId={userId}
        isCurrent={annotation.id === currentId} onSeek={onSeek} onDelete={handleDelete} onPendingChange={onPendingChange} />
      : <AnnotationRow key={annotation.id} annotation={annotation} speechId={speechId} reviewId={reviewId} userId={userId}
        videoEl={videoEl} autoPause={autoPause} annotations={annotations} durationMs={durationMs} isCurrent={annotation.id === currentId}
        onSeek={onSeek} onDelete={handleDelete} onLiveChange={onLiveChange} onLiveRemove={onLiveRemove}
        onSaved={onSaved} onSilentAdopt={onSilentAdopt} onPendingChange={onPendingChange} />)}
    {annotations.length === 0 && <li className="text-sm text-muted-foreground">No annotations yet. Choose Start and End above to add one.</li>}
  </ol>
}
