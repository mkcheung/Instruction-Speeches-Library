import { useEffect, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldMessage, FormBanner } from '@/components/ui/form-message'
import { applyServerErrors } from '@/lib/applyServerErrors'
import { useUpdateSpeechMutation } from '@/features/speech/speechApi'
import type { Speech } from '@/features/speech/types'
import type { UpdateSpeechPayload } from '@/features/speech/types'

/**
 * §7.5 frontend: edit a subset of a speech's own fields
 * (title/description/delivered_on/change_note — NOT `captions_enabled`,
 * which has its own route, and NOT `supersedes_id`, which isn't editable
 * post-create at all per §7.5.6). Deliberately a plain form dialog, not
 * `SpeechDeleteDialog`'s typed-confirmation pattern — editing isn't
 * destructive, so friction proportional to consequence means no
 * confirmation step here at all.
 *
 * Reuses `SpeechCreate.tsx`'s field markup (same `Label`/`Input`/
 * `Textarea`/`FieldMessage` pattern, same `applyServerErrors` 422
 * handling) rather than inventing a new one — this is the same four
 * fields minus the supersedes picker, which never applies after create.
 *
 * No existing `ui/dialog.tsx` wrapper exists in this codebase (only
 * `alert-dialog.tsx`, for the destructive-confirmation case) and adding
 * one is out of this task's file scope, so this imports
 * `@base-ui/react/dialog` directly — same primitive family, same
 * Root/Portal/Backdrop/Popup/Title shape `alert-dialog.tsx` already
 * wraps, just without the "alert" semantics an ordinary edit form
 * shouldn't claim.
 *
 * Controlled via `open`/`onOpenChange` (not an internal trigger) so the
 * owner menu in `MySpeeches.tsx` can drive it from a dropdown menu item —
 * a `DialogTrigger` rendered as a menu item would fight the menu's own
 * close-on-select behavior, the same reasoning `ProfileConnectionAction`'s
 * block dialog docblock gives for keeping its `AlertDialogRoot` standalone.
 */
interface EditFormValues {
  title: string
  description: string
  delivered_on: string
  change_note: string
}

function toFormValues(speech: Speech): EditFormValues {
  return {
    title: speech.title,
    description: speech.description ?? '',
    delivered_on: speech.delivered_on ?? '',
    change_note: '',
  }
}

export function SpeechEditDialog({
  speech,
  open,
  onOpenChange,
}: {
  speech: Speech
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [updateSpeech, { isLoading }] = useUpdateSpeechMutation()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<EditFormValues>({ defaultValues: toFormValues(speech) })

  // Re-seed the form every time the dialog opens (or the underlying speech
  // changes while it's open) — an edit dialog left mounted-but-closed
  // across a poll-driven `listSpeeches` refetch must not show stale
  // values the next time it opens.
  useEffect(() => {
    if (open) {
      reset(toFormValues(speech))
      // `open`/`speech` are both props owned by the parent, not local
      // state derivable at render time — reacting to either changing is
      // the "synchronize with an external signal" case effects exist for.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reset` is stable from react-hook-form
  }, [open, speech])

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)

    const trimmedTitle = values.title.trim()
    const normalizedDescription = values.description.trim() === '' ? null : values.description
    const normalizedDeliveredOn = values.delivered_on.trim() === '' ? null : values.delivered_on
    const trimmedChangeNote = values.change_note.trim()

    // Only the fields that actually changed — `PATCH` fields are all
    // `sometimes` server-side, and sending an unchanged field back is
    // harmless but noisy, so this keeps the request minimal on purpose.
    const body: UpdateSpeechPayload = {}
    if (trimmedTitle !== speech.title) body.title = trimmedTitle
    if (normalizedDescription !== (speech.description ?? null)) body.description = normalizedDescription
    if (normalizedDeliveredOn !== (speech.delivered_on ?? null)) body.delivered_on = normalizedDeliveredOn
    if (trimmedChangeNote !== '') body.change_note = trimmedChangeNote

    if (Object.keys(body).length === 0) {
      onOpenChange(false)
      return
    }

    try {
      await updateSpeech({ speechId: speech.id, body }).unwrap()
      onOpenChange(false)
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Popup
          data-testid="speech-edit-dialog"
          className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
        >
          <DialogPrimitive.Title className="text-base font-semibold">Edit speech</DialogPrimitive.Title>

          <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-4" noValidate>
            <FormBanner message={formError} />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-speech-title">Title</Label>
              <Input
                id="edit-speech-title"
                aria-invalid={!!errors.title}
                {...register('title', { required: 'Title is required.' })}
              />
              <FieldMessage message={errors.title?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-speech-description">Description</Label>
              <Textarea
                id="edit-speech-description"
                rows={3}
                aria-invalid={!!errors.description}
                {...register('description')}
              />
              <FieldMessage message={errors.description?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-speech-delivered-on">Delivered on</Label>
              <Input id="edit-speech-delivered-on" type="date" {...register('delivered_on')} />
              <FieldMessage message={errors.delivered_on?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-speech-change-note">What changed? (optional)</Label>
              <Textarea
                id="edit-speech-change-note"
                rows={2}
                placeholder="Cut the third example, slowed down the opening…"
                aria-invalid={!!errors.change_note}
                {...register('change_note')}
              />
              <FieldMessage message={errors.change_note?.message} />
            </div>

            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
