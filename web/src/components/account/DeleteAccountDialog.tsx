import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useDeleteAccountMutation, privacyApi } from '@/features/privacy/privacyApi'
import { authApi } from '@/features/auth/authApi'
import { profileApi } from '@/features/profile/profileApi'
import { getErrorStatus } from '@/lib/errorStatus'
import type { AppDispatch } from '@/app/store'

const CONFIRM_WORD = 'DELETE'

/**
 * STEP-11-FROZEN-CONTRACT.md §10: shares the typed-confirmation shape with
 * `ClearAnnotationsDialog.tsx` through `ConfirmDialog`,
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
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setTyped('')
          setError(null)
        }
      }}
      trigger={{ label: 'Delete my account' }}
      testId="delete-account-dialog"
      title="Delete your account?"
      description="This is permanent. Deleting your account:"
      confirm={{ word: CONFIRM_WORD, inputId: 'delete-confirm-input', value: typed, onChange: setTyped }}
      error={error}
      canConfirm={canConfirm}
      pending={isLoading}
      actionLabel="Delete my account"
      pendingLabel="Deleting…"
      onCancel={() => setOpen(false)}
      onConfirm={() => void handleDelete()}
    >
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
    </ConfirmDialog>
  )
}
