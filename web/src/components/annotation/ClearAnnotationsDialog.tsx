import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

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
  disabled = false,
}: {
  isPublished: boolean
  isClearing: boolean
  onConfirm: () => void
  disabled?: boolean
}) {
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)

  const canConfirm = !isPublished || typed.trim().toUpperCase() === CONFIRM_WORD

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setTyped('')
      }}
      trigger={{ label: 'Clear all notes', disabled: disabled || isClearing }}
      testId="clear-annotations-dialog"
      title="Clear every note in this set?"
      description={isPublished
        ? 'This review has already published commentary. Clearing removes every note — published and draft — but leaves the review, the access grant and the acceptance record intact.'
        : "This removes every draft note. Nothing here has been published yet."}
      confirm={isPublished
        ? { word: CONFIRM_WORD, inputId: 'clear-confirm-input', value: typed, onChange: setTyped }
        : undefined}
      canConfirm={canConfirm && !disabled}
      pending={isClearing}
      actionLabel="Clear all notes"
      pendingLabel="Clearing…"
      onCancel={() => setOpen(false)}
      onConfirm={() => {
        onConfirm()
        setOpen(false)
      }}
    />
  )
}
