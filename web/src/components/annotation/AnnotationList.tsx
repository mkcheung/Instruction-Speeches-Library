import { AnnotationRow } from '@/components/annotation/AnnotationRow'
import { VoiceAnnotationRow } from '@/components/annotation/VoiceAnnotationRow'
import { useToastManager } from '@/components/ui/toast'
import {
  useCreateAnnotationMutation,
  useDeleteAnnotationMutation,
  useRestoreVoiceAnnotationMutation,
} from '@/features/annotation/annotationApi'
import type { Annotation } from '@/features/annotation/types'
import { formatSpokenTimecode } from '@/lib/time'
import { compareByStartThenId } from '@/lib/annotationOrder'

/** §10.1's Undo window. */
const UNDO_TIMEOUT_MS = 6000

/**
 * The linear, readable-without-video list (§8.4/§8.6) plus delete+Undo
 * (§8.4/§10.1/acceptance list: "Delete-then-Undo restores it, and
 * re-creating with the same `client_uuid` does not collide").
 *
 * Delete fires immediately (contract item 3: "NOT deferred until the toast
 * expires") and the just-deleted row's full field values are retained by
 * ordinary JS closure over `annotation` for the toast's `actionProps`
 * lifetime — that's "in memory for at least 6 seconds," satisfying the
 * frozen contract's requirement without any extra storage plumbing. Undo
 * re-POSTs via `createAnnotation` with the SAME `client_uuid`, which the
 * backend's idempotency guarantee (contract item 1) turns into "bring the
 * tombstoned row back" rather than a duplicate.
 */
export function AnnotationList({
  annotations,
  speechId,
  reviewId,
  videoEl,
  autoPause,
  currentId,
  onSeek,
  onLiveChange,
  onLiveRemove,
  onSaved,
  onSilentAdopt,
}: {
  annotations: readonly Annotation[]
  speechId: number
  reviewId: number
  videoEl: HTMLVideoElement | null
  autoPause: boolean
  currentId: string | null
  onSeek: (seconds: number) => void
  onLiveChange: (live: Annotation) => void
  onLiveRemove: (id: string) => void
  onSaved?: (annotation: Annotation) => void
  onSilentAdopt?: (annotation: Annotation) => void
}) {
  const [deleteAnnotation] = useDeleteAnnotationMutation()
  const [createAnnotation] = useCreateAnnotationMutation()
  const [restoreVoiceAnnotation] = useRestoreVoiceAnnotationMutation()
  const toastManager = useToastManager()

  const sorted = [...annotations].sort(compareByStartThenId)

  const handleDelete = async (annotation: Annotation) => {
    try {
      await deleteAnnotation({ speechId, reviewId, annotationId: annotation.id }).unwrap()
    } catch {
      toastManager.add({ title: 'Could not delete', description: 'Try again.', timeout: 4000 })
      return
    }

    // Only drop the live-preview override once the row is confirmed gone —
    // doing this before the request resolves meant a failed delete left a
    // still-open editor's unsaved text with no override backing it, and a
    // successful-looking optimistic revert either way.
    onLiveRemove(annotation.id)

    // Guards against a double-fire on the action button while a request is
    // in flight (belt-and-braces — server-side `client_uuid` idempotency
    // would absorb a genuine duplicate anyway, but there's no reason to
    // send one) WITHOUT permanently latching on failure: a failed un-delete
    // must stay retryable for as long as the toast is showing.
    let undoStatus: 'idle' | 'pending' | 'done' = 'idle'

    toastManager.add({
      title: 'Note deleted',
      description: `At ${formatSpokenTimecode(annotation.start_seconds)}`,
      timeout: UNDO_TIMEOUT_MS,
      actionProps: {
        children: 'Undo',
        onClick: () => {
          if (undoStatus !== 'idle') return
          undoStatus = 'pending'
          void createAnnotation({
            speechId,
            reviewId,
            body: {
              client_uuid: annotation.client_uuid,
              body: annotation.body,
              start_seconds: annotation.start_seconds,
              duration_seconds: annotation.duration_seconds,
              kind: annotation.kind,
              topic: annotation.topic,
            },
          })
            .unwrap()
            .then(() => {
              undoStatus = 'done'
            })
            .catch(() => {
              undoStatus = 'idle'
              toastManager.add({ title: 'Could not undo', description: 'Try again.', timeout: 4000 })
            })
        },
      },
    })
  }

  const handleVoiceDelete = async (annotation: Annotation) => {
    try {
      await deleteAnnotation({ speechId, reviewId, annotationId: annotation.id }).unwrap()
      onLiveRemove(annotation.id)
      let undoPending = false
      toastManager.add({
        title: 'Voice note deleted',
        timeout: UNDO_TIMEOUT_MS,
        actionProps: {
          children: 'Undo',
          onClick: () => {
            if (undoPending) return
            undoPending = true
            void restoreVoiceAnnotation({ speechId, reviewId, annotationId: annotation.id })
              .unwrap()
              .catch(() => {
                undoPending = false
                toastManager.add({ title: 'Could not undo', description: 'Try again.', timeout: 4000 })
              })
          },
        },
      })
    } catch {
      toastManager.add({ title: 'Could not delete', description: 'Try again.', timeout: 4000 })
    }
  }

  return (
    <ol className="flex flex-col gap-2" aria-label="Your commentary">
      {sorted.map((a) =>
        a.voice !== null ? (
          <VoiceAnnotationRow
            key={a.id}
            annotation={a}
            speechId={speechId}
            reviewId={reviewId}
            isCurrent={a.id === currentId}
            onSeek={onSeek}
            onDelete={handleVoiceDelete}
          />
        ) : (
          <AnnotationRow
            key={a.id}
            annotation={a}
            speechId={speechId}
            reviewId={reviewId}
            videoEl={videoEl}
            autoPause={autoPause}
            isCurrent={a.id === currentId}
            onSeek={onSeek}
            onDelete={handleDelete}
            onLiveChange={onLiveChange}
            onSaved={onSaved}
            onSilentAdopt={onSilentAdopt}
          />
        ),
      )}
      {sorted.length === 0 && <li className="text-sm text-muted-foreground">No notes yet — start typing above.</li>}
    </ol>
  )
}
