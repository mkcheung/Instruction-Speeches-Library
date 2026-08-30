import { useState } from 'react'
import { useDispatch } from 'react-redux'
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
import { useDeleteAccountMutation, privacyApi } from '@/features/privacy/privacyApi'
import { authApi } from '@/features/auth/authApi'
import { profileApi } from '@/features/profile/profileApi'
import { getErrorStatus } from '@/lib/errorStatus'
import type { AppDispatch } from '@/app/store'

const CONFIRM_WORD = 'DELETE'

/**
 * STEP-11-FROZEN-CONTRACT.md §10: copies `ClearAnnotationsDialog.tsx`'s
 * typed-confirmation `AlertDialogRoot` shape verbatim (new confirm word),
 * because this is the same "friction proportional to consequence"
 * pattern applied to a permanent, whole-account action rather than one
 * annotation set.
 *
 * STEP-11.md's frontend section is explicit that the consequences must be
 * "stated plainly — including that erasing a speaker destroys every
 * reviewer's work on their speeches, which is correct and must be
 * surfaced rather than discovered." The itemized list below exists for
 * that line specifically — a one-sentence summary would be the
 * euphemism the plan is warning against.
 *
 * Post-success navigation copies `LogoutMenuItem`'s exact pattern: a hard
 * `window.location.assign('/login')` (throws away every RTK Query cache
 * in one shot — the deleted user's own data must not linger in any
 * slice's cache) plus `resetApiState()` on `authApi`/`profileApi`/the new
 * `privacyApi`, and the same three-outcome handling — success and
 * "already 401" both navigate away, a genuine failure does not (that
 * would bounce a still-logged-in user through `RequireGuest`'s
 * `/onboarding` redirect, same reasoning `LogoutMenuItem`'s own comment
 * gives).
 */
export function DeleteAccountDialog() {
  const [deleteAccount, { isLoading }] = useDeleteAccountMutation()
  const dispatch = useDispatch<AppDispatch>()
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canConfirm = typed.trim() === CONFIRM_WORD

  const resetAllApiCaches = () => {
    dispatch(authApi.util.resetApiState())
    dispatch(profileApi.util.resetApiState())
    dispatch(privacyApi.util.resetApiState())
  }

  const handleDelete = async () => {
    setError(null)
    try {
      await deleteAccount({ confirm: typed.trim() }).unwrap()
      resetAllApiCaches()
      window.location.assign('/login')
    } catch (caught) {
      if (getErrorStatus(caught) === 401) {
        resetAllApiCaches()
        window.location.assign('/login')
        return
      }
      setError('Could not delete your account — try again.')
    }
  }

  return (
    <AlertDialogRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setTyped('')
          setError(null)
        }
      }}
    >
      <AlertDialogTrigger render={<Button type="button" variant="destructive" size="sm" />}>
        Delete my account
      </AlertDialogTrigger>
      <AlertDialogPortal>
        <AlertDialogBackdrop />
        <AlertDialogPopup data-testid="delete-account-dialog">
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>This is permanent. Deleting your account:</AlertDialogDescription>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Removes every speech you own, along with its video, poster, captions and transcript.</li>
            <li>
              Destroys every reviewer's commentary, essays and voice notes on your speeches — this
              cannot be recovered, and reviewers are not notified in advance.
            </li>
            <li>
              Deletes the voice notes you recorded on other people's speeches (the written
              annotations stay, attributed to "Former reviewer").
            </li>
            <li>Releases your username and permanently scrubs your profile — this cannot be undone.</li>
          </ul>

          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="delete-confirm-input">
              Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
            </Label>
            <Input
              id="delete-confirm-input"
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!canConfirm || isLoading}
              onClick={() => void handleDelete()}
            >
              {isLoading ? 'Deleting…' : 'Delete my account'}
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialogPortal>
    </AlertDialogRoot>
  )
}
