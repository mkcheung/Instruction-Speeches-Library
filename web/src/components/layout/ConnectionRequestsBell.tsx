import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPortal,
  PopoverPositioner,
  PopoverPopup,
} from '@/components/ui/popover'
import {
  useAcceptConnectionMutation,
  useDeclineConnectionMutation,
  useGetPendingConnectionRequestsQuery,
} from '@/features/connection/connectionApi'

/**
 * STEP-13-social-layer.md's demo script ("Send someone a connection
 * request. They accept.") had no reachable UI path for the recipient's
 * half until the STEP-13 reconciliation audit found `GET /api/connections`
 * only ever returned accepted rows — there was no way to discover a
 * pending request's id at all. This mirrors `NotificationBell.tsx`'s
 * popover shape exactly (same Base UI primitives, same header-icon
 * pattern) rather than a new dashboard page, since STEP-13's own frontend
 * file list never named a pending-requests surface — this is the minimal
 * real affordance the fix needed, not a new page.
 */
export function ConnectionRequestsBell() {
  const { data } = useGetPendingConnectionRequestsQuery()
  const [acceptConnection, { isLoading: isAccepting }] = useAcceptConnectionMutation()
  const [declineConnection, { isLoading: isDeclining }] = useDeclineConnectionMutation()

  const requests = data?.connections ?? []
  const count = requests.length

  return (
    <PopoverRoot modal={false}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={count > 0 ? `Connection requests (${count} pending)` : 'Connection requests'}
          />
        }
        className="relative"
      >
        <PeopleIcon />
        {count > 0 && (
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]"
          >
            {count > 9 ? '9+' : count}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverPositioner align="end">
          <PopoverPopup aria-label="Connection requests">
            {requests.length === 0 && (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">No pending requests.</p>
            )}
            <ul className="flex flex-col gap-1">
              {requests.map((request) => (
                <li key={request.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                  <span className="min-w-0 truncate">{request.peer?.name ?? request.peer?.username}</span>
                  <span className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      disabled={isAccepting || isDeclining}
                      onClick={() => void acceptConnection(request.id)}
                    >
                      Accept
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isAccepting || isDeclining}
                      onClick={() => void declineConnection(request.id)}
                    >
                      Decline
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </PopoverRoot>
  )
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
