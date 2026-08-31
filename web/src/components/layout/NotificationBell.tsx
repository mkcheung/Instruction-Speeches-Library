import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPortal,
  PopoverPositioner,
  PopoverPopup,
} from '@/components/ui/popover'
import { useListNotificationsQuery, useMarkNotificationReadMutation } from '@/features/notification/notificationApi'
import type { Notification } from '@/features/notification/types'
import { cn } from '@/lib/utils'

/**
 * STEP-05-invitation-loop.md's "in-app notification bell," rebuilt on
 * Base UI's `popover` per D6 (PLAN-APP-HEADER.md) before moving into the
 * global header — the original panel was a bare `<div>` with a `<ul>`
 * inside: no `role`, no `Esc`, no outside-click, no `aria-haspopup`. D6's
 * condition was "bring the bell up to the same bar as the user menu in
 * the same change, or leave it on Dashboard"; this is that change.
 * `popover` defaults `modal` to `false`, matching D7's requirement that
 * the header not scroll-lock the page over a playing video on
 * `SpeechWatch`.
 */
function describe(notification: Notification): string {
  const { type, actor_name: actor, speech_title: title } = notification.data
  const speech = title ?? 'a speech'

  switch (type) {
    case 'review.invited':
      return actor ? `${actor} invited you to review "${speech}"` : `You were invited to review "${speech}"`
    case 'review.accepted':
      return actor ? `${actor} accepted your invitation on "${speech}"` : `Your invitation on "${speech}" was accepted`
    case 'review.declined':
      return actor ? `${actor} declined your invitation on "${speech}"` : `Your invitation on "${speech}" was declined`
    // STEP-12-FROZEN-CONTRACT.md §9: `coach_application.approved`/
    // `.rejected` — this `switch` is deliberately enumerated, not
    // generic-fallback-safe (the `default` below exists for genuinely
    // unrecognized types, not as a place to skip adding a case), so each
    // new notification type from the backend needs its own case here.
    case 'coach_application.approved':
      return 'Your coach application was approved — your profile now shows a Coach badge.'
    case 'coach_application.rejected':
      return 'Your coach application was not approved.'
    default:
      return speech
  }
}

export function NotificationBell() {
  const { data } = useListNotificationsQuery(undefined, { pollingInterval: 30000 })
  const [markRead] = useMarkNotificationReadMutation()

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unread_count ?? 0

  return (
    <PopoverRoot modal={false}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
          />
        }
        className="relative"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverPositioner align="end">
          <PopoverPopup aria-label="Notifications">
            {notifications.length === 0 && (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">No notifications.</p>
            )}
            <ul className="flex flex-col gap-1">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => !notification.read_at && markRead(notification.id)}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                      !notification.read_at && 'font-medium',
                    )}
                  >
                    {describe(notification)}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </PopoverRoot>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
