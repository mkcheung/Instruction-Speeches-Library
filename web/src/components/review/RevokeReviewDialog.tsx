import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { RosterReview } from '@/features/review/types'

const CONFIRM_WORD = 'DELETE'

/**
 * IMPLEMENTATION-PLANS.md §7.2.6: "Follow `ClearAnnotationsDialog.tsx`
 * exactly — it is the codebase's only non-admin destructive-dialog
 * precedent and already implements friction proportional to
 * consequence." Two modes in one component, selected by `mode`:
 *
 * - `'revoke'` — ends access, leaves the reviewer's notes/essay intact.
 * - `'purge'` — ends access AND deletes the reviewer's notes, essay and
 *   voice recordings (`revokeAndPurge`'s cascade, §7.2.1).
 *
 * §7.2.5: `RevokeReviewRequest`'s reason is required on a FIRST revoke —
 * which this dialog only ever drives (a `review` already showing
 * `revoked_at` renders in the Closed group with no actions at all, so
 * this component is never mounted against an already-revoked row) — so
 * the reason field is mandatory for BOTH modes, not just purge. The
 * type-the-word confirmation gate is purge-only: proportional friction,
 * same as `ClearAnnotationsDialog`'s `isPublished` gate.
 */
export function RevokeReviewDialog({
  review,
  mode,
  isSubmitting,
  onConfirm,
}: {
  review: RosterReview
  mode: 'revoke' | 'purge'
  isSubmitting: boolean
  /** Must reject on failure (e.g. `mutation(...).unwrap()`) — the dialog
   * only closes once this resolves, so a 403/422/500 keeps it open with
   * an error shown rather than silently telling the speaker the action
   * succeeded. See this file's code-review note below. */
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setReason('')
    setTyped('')
    setError(null)
  }

  // code-review finding: the Cancel button used to call `setOpen(false)`
  // directly, which sets the `AlertDialogRoot`'s controlled `open` prop
  // from OUTSIDE the primitive's own gesture handling — `onOpenChange`
  // (where `reset()` lives, below) only fires for the Root's own internal
  // close gestures, never for a parent changing the controlled prop
  // itself (verified against @base-ui/react's AlertDialogRoot). Without
  // this, Cancel left a failed attempt's `reason`/`typed`/`error` sitting
  // in state for the next time this same row's dialog is reopened — most
  // consequentially, a failed PURGE attempt's typed "DELETE" confirmation
  // would already satisfy `canConfirm` on reopen, letting a fresh attempt
  // submit without the safety word being re-typed at all.
  const closeAndReset = () => {
    setOpen(false)
    reset()
  }

  const reasonOk = reason.trim().length > 0
  const typedOk = mode === 'revoke' || typed.trim().toUpperCase() === CONFIRM_WORD
  const canConfirm = reasonOk && typedOk

  const triggerLabel = mode === 'purge' ? 'Revoke and delete their work' : 'Revoke'

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
      trigger={{ label: triggerLabel }}
      testId={mode === 'purge' ? 'revoke-and-purge-dialog' : 'revoke-dialog'}
      title={mode === 'purge' ? 'Revoke access and delete their work?' : 'Revoke this reviewer’s access?'}
      description={mode === 'purge'
        ? `This deletes ${review.annotations_count} note${review.annotations_count === 1 ? '' : 's'}, ${review.published_annotations_count} of them published, along with their essay and any voice recordings. This cannot be undone.`
        : 'This ends their access to the speech. Their notes, essay and voice recordings stay exactly as they are — nothing here is deleted.'}
      confirm={mode === 'purge'
        ? { word: CONFIRM_WORD, inputId: 'revoke-purge-confirm-input', value: typed, onChange: setTyped }
        : undefined}
      /* code-review finding: this used to call `onConfirm` and close
        the dialog unconditionally in the same tick, regardless of
        whether the mutation actually succeeded — a 403/422/500
        still closed the dialog with no error shown, telling the
        speaker the revoke/purge happened when it hadn't. Now the
        dialog only closes once `onConfirm`'s promise resolves. */
      error={error}
      canConfirm={canConfirm}
      pending={isSubmitting}
      actionLabel={triggerLabel}
      pendingLabel="Working…"
      onCancel={closeAndReset}
      onConfirm={() => {
        setError(null)
        onConfirm(reason.trim())
          .then(closeAndReset)
          .catch(() => setError('Something went wrong. Try again.'))
      }}
    >
      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor="revoke-reason-input">Reason</Label>
        <Textarea
          id="revoke-reason-input"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Tell them why — this is shown to them."
        />
      </div>
    </ConfirmDialog>
  )
}
