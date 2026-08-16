import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialogRoot,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog'

const CONFIRM_WORD = 'CLEAR'

/**
 * MODERNIZATION_PLAN.md §8.4: "Deleting the whole set gets a real
 * `role="alertdialog"` [...], with a typed confirmation only if it was
 * already published — friction proportional to consequence."
 *
 * `isPublished` is read off the REVIEW (`review.first_published_at !==
 * null`), not a per-row flag on `Annotation` — the frozen STEP-07 contract
 * only adds `lock_version`/`client_uuid` to the annotation shape, no
 * published-at marker the composer could use instead. `review` is already
 * fetched by the panel (it needs it to find `reviewId` in the first
 * place), so this costs no extra request.
 */
export function ClearAnnotationsDialog({
  isPublished,
  isClearing,
  onConfirm,
}: {
  isPublished: boolean
  isClearing: boolean
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)

  const canConfirm = !isPublished || typed.trim().toUpperCase() === CONFIRM_WORD

  return (
    <AlertDialogRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setTyped('')
      }}
    >
      <AlertDialogTrigger render={<Button type="button" variant="destructive" size="sm" />}>
        Clear all notes
      </AlertDialogTrigger>
      <AlertDialogPortal>
        <AlertDialogBackdrop />
        <AlertDialogPopup data-testid="clear-annotations-dialog">
          <AlertDialogTitle>Clear every note in this set?</AlertDialogTitle>
          <AlertDialogDescription>
            {isPublished
              ? 'This review has already published commentary. Clearing removes every note — published and draft — but leaves the review, the access grant and the acceptance record intact.'
              : "This removes every draft note. Nothing here has been published yet."}
          </AlertDialogDescription>

          {isPublished && (
            <div className="mt-3 flex flex-col gap-1.5">
              <Label htmlFor="clear-confirm-input">
                Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
              </Label>
              <Input
                id="clear-confirm-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!canConfirm || isClearing}
              onClick={() => {
                onConfirm()
                setOpen(false)
              }}
            >
              {isClearing ? 'Clearing…' : 'Clear all notes'}
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialogPortal>
    </AlertDialogRoot>
  )
}
