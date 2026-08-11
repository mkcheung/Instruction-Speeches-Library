import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useListNotificationsQuery, useMarkNotificationReadMutation } from '@/features/notification/notificationApi'
import type { Notification } from '@/features/notification/types'
import { cn } from '@/lib/utils'

/**
 * STEP-05-invitation-loop.md's "in-app notification bell." This codebase
 * has no shared header/nav component yet to mount it on permanently (no
 * `components/layout/*` existed before this step) — it's a standalone,
 * self-contained widget any authenticated page can drop in; `Dashboard.tsx`
 * does.
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
    default:
      return speech
  }
}
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const { data } = useListNotificationsQuery(undefined, { pollingInterval: 30000 })
  const [markRead] = useMarkNotificationReadMutation()

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unread_count ?? 0

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon />
      </Button>
      {unreadCount > 0 && (
        <Badge
          variant="destructive"
          className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </Badge>
      )}

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-72 rounded-lg border border-border bg-card p-2 shadow-lg">
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
        </div>
      )}
    </div>
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
