import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialogRoot,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog'
import { useDeleteSpeechMutation } from '@/features/speech/speechApi'
import type { Speech } from '@/features/speech/types'
import { extractServerErrorMessage } from '@/lib/applyServerErrors'

/**
 * §7.5.2/§7.5.3(i): typed-confirmation `AlertDialogRoot`, adapted from
 * `DeleteAccountDialog.tsx` — "friction proportional to an irreversible
 * consequence" applied to one speech instead of a whole account.
 *
 * Confirm word is deliberately `REMOVE`, not the account dialog's
 * `DELETE` reused verbatim. Typing muscle memory is the actual risk here:
 * a speaker who has typed `DELETE` into the account dialog before (or
 * will later) must not find that same typed word also satisfies this
 * dialog by habit — the confirm word is the ONE thing standing between a
 * misclick and an irreversible removal, so it needs to be a deliberate,
 * distinct keystroke, not a muscle-memory default. `REMOVE` also matches
 * the dialog's own copy ("Removed now…") rather than borrowing a word
 * from a different, unrelated action.
 *
 * Copy matches §7.5.3(i)'s decided honesty posture exactly: "Removed now.
 * The video file is erased within 24 hours." — not bare "permanent", and
 * not implying the database row itself survives either. This mirrors
 * `DeleteAccountDialog`'s own posture (says "permanent" while technically
 * anonymizing rather than row-deleting) — the claim is about access and
 * bytes, not whether a row technically persists for the operational
 * purge window. No restore affordance is offered anywhere in this
 * dialog: the 24-hour window is a backend purge delay, not a user-facing
 * trash can, so the copy must not suggest otherwise.
 *
 * Controlled via `open`/`onOpenChange`, same reasoning as
 * `SpeechEditDialog` — driven by a dropdown menu item in `MySpeeches.tsx`,
 * not its own trigger. Only wired from `MySpeeches.tsx` in this task; on
 * success there is nothing to navigate to — closing the dialog is enough,
 * since the mutation's tag invalidation makes the speech disappear from
 * the grid on its own.
 */
const CONFIRM_WORD = 'REMOVE'

export function SpeechDeleteDialog({
  speech,
  open,
  onOpenChange,
}: {
  speech: Speech
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [deleteSpeech, { isLoading }] = useDeleteSpeechMutation()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canConfirm = typed.trim() === CONFIRM_WORD

  useEffect(() => {
    if (!open) {
      // Reacting to `open` — a prop owned by the parent, not local state
      // this component could derive the reset from at render time — is
      // exactly the "synchronize with an external signal" case effects
      // exist for, not the "state derivable from props" case the
      // set-state-in-effect rule otherwise guards against. Clearing the
      // typed confirmation and any stale error on close is what stops a
      // half-typed word or a previous attempt's error from surviving into
      // the next time this dialog opens.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTyped('')
      setError(null)
    }
  }, [open])

  const handleDelete = async () => {
    setError(null)
    try {
      await deleteSpeech(speech.id).unwrap()
      onOpenChange(false)
    } catch (caught) {
      // code-review finding: this used to discard the real server error
      // and always show a generic "try again" — including for a 410 (the
      // speech was already removed, in another tab or by a concurrent
      // admin takedown), where "try again" against a permanently-410ing
      // endpoint is actively misleading. `extractServerErrorMessage` is
      // the same form-less 422-and-beyond helper `DeleteAccountDialog`/
      // `UploadDashboard` already use for exactly this shape.
      setError(extractServerErrorMessage(caught))
    }
  }

  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      <AlertDialogPortal>
        <AlertDialogBackdrop />
        <AlertDialogPopup data-testid="speech-delete-dialog">
          <AlertDialogTitle>Remove "{speech.title}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Removed now. The video file is erased within 24 hours.
          </AlertDialogDescription>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Every reviewer loses access to it immediately.</li>
            <li>There is no undo from here.</li>
          </ul>

          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="speech-delete-confirm-input">
              Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
            </Label>
            <Input
              id="speech-delete-confirm-input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>

          {error && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!canConfirm || isLoading}
              onClick={() => void handleDelete()}
            >
              {isLoading ? 'Removing…' : 'Remove speech'}
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialogPortal>
    </AlertDialogRoot>
  )
}
