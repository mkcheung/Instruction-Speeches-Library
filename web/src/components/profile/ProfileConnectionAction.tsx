import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { FormBanner } from '@/components/ui/form-message'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuPopup,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialogRoot,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog'
import { applyServerErrors } from '@/lib/applyServerErrors'
import { sendConnectionRequestSchema, type SendConnectionRequestFormValues } from '@/lib/validation'
import { formatMonthYear } from '@/lib/connectionMetricLine'
import { useSendConnectionRequestMutation, useBlockConnectionMutation } from '@/features/connection/connectionApi'
import type { Connection } from '@/features/connection/types'

/**
 * §6.7.4's identity-block action slot (`[ Request a review ]  [ ⋯ ]`),
 * repurposed here as the CONNECTION action + block menu — wiring an
 * actual "request a review from this profile" flow (choosing which of the
 * viewer's own speeches to send) is a separate, unspecced surface not
 * listed in this build's scope, so this slot renders whichever connection
 * action applies instead.
 *
 * ⚠️ Only TWO states are actually distinguishable against the real
 * backend: "accepted" (found in `GET /api/connections`, which returns
 * `state = 'accepted'` rows only) and "no accepted connection." Pending
 * (either direction) and blocked are both invisible to the frontend — no
 * endpoint returns them — so this component cannot render "Accept /
 * Decline an incoming request" or "Request sent" the way an earlier,
 * pre-backend version of this file guessed it could. Sending a request
 * when one is already pending, declined, or blocked is left to the
 * backend's own idempotent-upsert/`ConnectionBlockedException` handling
 * (`ConnectionService::request`'s docblock) — the error, if any, surfaces
 * through the normal `applyServerErrors` banner.
 *
 * `existing` is the viewer's own ACCEPTED connection row for this profile
 * owner, if any (looked up in `PublicProfile.tsx` out of the rail's full
 * list). `profileUserId` is the numeric id needed to send a NEW request —
 * `PublicProfile.tsx` passes `existingConnection?.peer?.id ?? profile.id`,
 * so it's available from the profile payload itself once an accepted
 * connection doesn't already cover it (`PublicProfileResource` originally
 * shipped with no `id` field at all — a real gap the STEP-13
 * reconciliation audit caught, fixed by adding `'id' => $this->id` there).
 * Kept optional/defensive here rather than required, since a caller
 * without either source still shouldn't crash — the disabled-button
 * fallback stays as a defense-in-depth, not the expected path.
 *
 * Block confirmation copies `ClearAnnotationsDialog.tsx`'s plain
 * `AlertDialogRoot` shape (no typed-word confirmation — reversible via
 * unblock, so a single confirm step is proportional, §8.4).
 */
export function ProfileConnectionAction({
  profileUserId,
  existing,
}: {
  profileUserId?: number
  existing: Connection | null
}) {
  const [requestOpen, setRequestOpen] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [sendRequest, { isLoading: isSending }] = useSendConnectionRequestMutation()
  const [blockConnection, { isLoading: isBlocking }] = useBlockConnectionMutation()

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SendConnectionRequestFormValues>({
    resolver: zodResolver(sendConnectionRequestSchema),
    defaultValues: { message: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    if (!profileUserId) return
    setFormError(null)
    try {
      await sendRequest({ user_id: profileUserId, note: values.message || null }).unwrap()
      setRequestOpen(false)
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  const handleBlock = async () => {
    if (!existing) return
    try {
      await blockConnection(existing.id).unwrap()
    } finally {
      setBlockOpen(false)
    }
  }

  if (existing?.state === 'accepted') {
    return (
      <div className="flex items-center gap-2">
        {existing.connected_at && (
          <span className="text-[13px] text-muted-foreground">
            Connected since {formatMonthYear(existing.connected_at)}
          </span>
        )}
        <DropdownMenuRoot modal={false}>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="ghost" size="icon-sm" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            }
          />
          <DropdownMenuPortal>
            <DropdownMenuPositioner align="end">
              <DropdownMenuPopup>
                <DropdownMenuItem onClick={() => setBlockOpen(true)}>Block</DropdownMenuItem>
              </DropdownMenuPopup>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenuRoot>

        {/* Standalone `AlertDialogRoot`, not nested inside the menu's
         * popup — a dialog trigger rendered as a menu item fights the
         * menu's own close-on-select behavior. The menu item above only
         * sets `blockOpen`; this dialog is controlled purely by that
         * state. */}
        <AlertDialogRoot open={blockOpen} onOpenChange={setBlockOpen}>
          <AlertDialogPortal>
            <AlertDialogBackdrop />
            <AlertDialogPopup>
              <AlertDialogTitle>Block this connection?</AlertDialogTitle>
              <AlertDialogDescription>
                They'll disappear from your connections rail. Their existing review of your speeches
                still exists — blocking doesn't revoke access already granted.
              </AlertDialogDescription>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setBlockOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" disabled={isBlocking} onClick={() => void handleBlock()}>
                  {isBlocking ? 'Blocking…' : 'Block'}
                </Button>
              </div>
            </AlertDialogPopup>
          </AlertDialogPortal>
        </AlertDialogRoot>
      </div>
    )
  }

  // No accepted connection found (covers: never connected, pending either
  // direction, declined, or blocked — all indistinguishable here).
  return (
    <>
      <Button
        type="button"
        size="sm"
        disabled={!profileUserId}
        title={!profileUserId ? "Connecting isn't available for this profile yet." : undefined}
        onClick={() => setRequestOpen(true)}
      >
        Connect
      </Button>
      {requestOpen && (
        <Card className="mt-2 w-full max-w-sm">
          <CardHeader>
            <CardTitle>Send a connection request</CardTitle>
            <CardDescription>Optionally add a note — they'll see it when deciding.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
              <FormBanner message={formError} />
              <Textarea
                rows={3}
                placeholder="Say hello…"
                aria-invalid={!!errors.message}
                {...register('message')}
              />
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={isSending}>
                  {isSending ? 'Sending…' : 'Send request'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setRequestOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  )
}
