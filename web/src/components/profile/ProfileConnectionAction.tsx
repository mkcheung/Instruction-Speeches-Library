import { useState } from 'react'
import { Link } from 'react-router-dom'
import { profilePath } from '@/lib/profilePath'
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
import type { FriendRelationship } from '@/features/connection/types'
import { connectionErrorMessage, useEligibleConnectionViewer } from '@/features/connection/connectionSession'

/** The viewer-owned projection covers pending and accepted relationships beyond page one. */
export function ProfileConnectionAction({
  profileUserId, relationship, refreshing, error, onRetry,
}: {
  profileUserId?: number
  relationship?: FriendRelationship
  refreshing: boolean
  error?: unknown
  onRetry: () => unknown
}) {
  const viewer = useEligibleConnectionViewer()
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
    if (!viewer || !profileUserId || refreshing || error || relationship?.state !== 'none') return
    setFormError(null)
    try {
      await sendRequest({ user_id: profileUserId, note: values.message || null }).unwrap()
      setRequestOpen(false)
    } catch (error) {
      setFormError(applyServerErrors(error, setError))
    }
  })

  const handleBlock = async () => {
    if (!viewer || refreshing || error || relationship?.state !== 'accepted' || !relationship.connection_id) return
    setFormError(null)
    try {
      await blockConnection(relationship.connection_id).unwrap()
      setBlockOpen(false)
    } catch (failure) {
      setFormError(connectionErrorMessage(failure))
    }
  }

  if (!viewer || !profileUserId || viewer.id === String(profileUserId)) return null
  if (error && !(blockOpen && relationship?.state === 'accepted')) return <div role="alert"><p>{connectionErrorMessage(error)}</p><Button type="button" variant="outline" size="sm" onClick={() => onRetry()} disabled={refreshing}>Retry relationship</Button></div>
  if (!relationship) return <p role="status">Checking connection…</p>
  if (relationship.state === 'unavailable') return <p>Connection unavailable.</p>
  if (relationship.state === 'pending') return relationship.direction === 'incoming'
    ? <Link to={profilePath(viewer.username, 'friends', 'requests')}>View friend request</Link>
    : <p role="status">Request sent</p>

  if (relationship.state === 'accepted') {
    return (
      <div className="flex items-center gap-2">
        {relationship.connected_at ? (
          <span className="text-[13px] text-muted-foreground">
            Connected since {formatMonthYear(relationship.connected_at)}
          </span>
        ) : <span>Connected</span>}
        <DropdownMenuRoot modal={false}>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="ghost" size="icon-sm" aria-label="More actions" disabled={refreshing || isBlocking || Boolean(error)}>
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
              <FormBanner message={formError} />
              {Boolean(error) && <div role="alert"><p>{connectionErrorMessage(error)}</p><Button type="button" variant="outline" onClick={() => onRetry()} disabled={refreshing}>Retry relationship</Button></div>}
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setBlockOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" disabled={isBlocking || refreshing || Boolean(error)} onClick={() => void handleBlock()}>
                  {isBlocking ? 'Blocking…' : 'Block'}
                </Button>
              </div>
            </AlertDialogPopup>
          </AlertDialogPortal>
        </AlertDialogRoot>
      </div>
    )
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        disabled={refreshing || isSending}
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
                <Button type="submit" disabled={isSending || refreshing}>
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
