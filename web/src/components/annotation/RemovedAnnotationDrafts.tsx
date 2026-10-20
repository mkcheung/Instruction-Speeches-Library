import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { clearAnnotationRecovery, discoverAnnotationReviewRecovery, type AnnotationRecoveryRecord } from '@/lib/annotationRecovery'
import type { Annotation } from '@/features/annotation/types'

/** Remote deletion must not strand a row editor's recovery behind a missing row. */
export function RemovedAnnotationDrafts({ userId, speechId, reviewId, annotations }: {
  userId?: string; speechId: number; reviewId: number; annotations: readonly Annotation[] | undefined
}) {
  const [drafts, setDrafts] = useState<AnnotationRecoveryRecord[]>([])
  const refresh = useCallback(() => {
    setDrafts(!userId || !annotations ? [] : discoverAnnotationReviewRecovery({ userId, speechId, reviewId })
      .filter((draft) => draft.scope.rowId !== null && !annotations.some((note) => note.id === draft.scope.rowId)))
  }, [userId, speechId, reviewId, annotations])
  useEffect(() => {
    // Reconcile a locally stored draft index with the server's live row set.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [refresh])
  if (!drafts.length) return null
  return <section aria-label="Preserved drafts for removed notes" className="space-y-2 rounded-md border border-border p-3">
    <p className="text-sm font-medium">Preserved drafts for removed notes</p>
    <p className="text-xs text-muted-foreground">An original note is no longer available. Its unsaved text is preserved below for you to copy; it has not been added or published again.</p>
    {drafts.map((draft) => <div key={`${draft.instanceId}:${draft.clientUuid}:${draft.revision}`} className="space-y-1">
      <p className="text-xs text-muted-foreground">{draft.fields.start} · {new Date(draft.updatedAt).toLocaleString()}</p>
      <textarea readOnly aria-label={`Preserved commentary from ${draft.fields.start}`} value={draft.fields.body} className="min-h-24 w-full rounded border border-input p-2 text-sm" />
      {draft.uncertain && <p className="text-xs text-muted-foreground">A prior save has an unresolved outcome. Keep this copy while the original note is unavailable.</p>}
      <Button type="button" variant="outline" size="sm" disabled={draft.uncertain !== null} onClick={() => { clearAnnotationRecovery(draft); refresh() }}>Discard preserved draft</Button>
    </div>)}
  </section>
}
