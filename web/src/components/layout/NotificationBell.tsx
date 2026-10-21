import type { KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
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
/**
 * `notification.data.url` is built server-side by `App\Support\FrontendUrl`,
 * which deliberately returns an ABSOLUTE url (scheme + host) — the same
 * string also goes into plain-text emails, where a host-relative path would
 * be useless. react-router's `<Link to>` is the opposite: it resolves `to`
 * against the SPA's own current route, so handing it an absolute string
 * (`https://app.speechcoach.test/speeches/42`) does not navigate there — it
 * gets treated as a path segment and resolves to garbage like
 * `/https:/app.speechcoach.test/speeches/42` (verified against the
 * installed `react-router`'s own `resolvePath`). Stripping the origin
 * before handing the value to `Link` is what makes the two sides agree.
 */
function toRouterPath(absoluteUrl: string): string {
  const parsed = new URL(absoluteUrl, window.location.origin)
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

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
    // STEP-15: `review.published` plus the three admin-action types
    // (`speech.taken_down`, `user.suspended`, `user.deleted`) — these
    // used to fall through to the generic `default` below and render as
    // the literal placeholder "a speech", which was wrong for all four
    // (an account-suspension notice has nothing to do with a speech).
    case 'review.published':
      return actor ? `${actor} published their feedback on "${speech}"` : `New feedback was published on "${speech}"`
    // Verified against `App\Notifications\SpeechTakenDown::toDatabase()`
    // — it sends `speech_title`, matching this switch's convention.
    case 'speech.taken_down':
      return `Your speech "${speech}" was taken down`
    case 'user.suspended':
      return 'Your account was suspended'
    case 'user.deleted':
      return 'Your account was deleted'
    // IMPLEMENTATION-PLANS.md §7.2.5: the one notification §7.2 ships —
    // to the reviewer, on `revoke`/`revokeAndPurge` only (withdraw/
    // abandon are the reviewer's own acts, so they get none). `purged`
    // changes the verb since a purge also destroys the reviewer's own
    // notes/essay, not just the access grant.
    case 'review.access_revoked':
      return notification.data.purged
        ? `Your access to "${speech}" was removed, and your notes on it were deleted.`
        : `Your access to "${speech}" was removed.`
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
          />
        }
        className="relative"
      >
        <span className="sr-only">
          {unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        </span>
        <BellIcon />
        {unreadCount > 0 && (
          <Badge
            aria-hidden="true"
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
              {notifications.map((notification) => {
                const rowClassName = cn(
                  'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                  !notification.read_at && 'font-medium',
                )
                const onVisit = () => !notification.read_at && markRead(notification.id)
                const url = notification.data.url
                const routerPath = url ? toRouterPath(url) : null
                // code-review finding: a native <a> only activates on
                // Enter, not Space — every other interactive control on
                // this row (and in this app) activates on both, via the
                // `Button` primitive. Not swapping to `Button` here: its
                // variant classes assume a fixed-height, centered control,
                // which conflicts with this row's left-aligned, can-wrap
                // text styling — would need most of them reset anyway.
                // `.click()` re-fires the same click path (this `onClick`
                // AND react-router's own `Link` handler), so Space and
                // Enter end up identical without touching layout at all.
                const activateOnSpace = (event: KeyboardEvent<HTMLAnchorElement>) => {
                  if (event.key === ' ') {
                    event.preventDefault()
                    event.currentTarget.click()
                  }
                }

                return (
                  <li key={notification.id}>
                    {/*
                     * STEP-15: a notification with a `url` navigates
                     * there (e.g. `review.published` → the review) and
                     * marks itself read on the same click. Without a
                     * `url` — e.g. `speech.taken_down`, whose speech
                     * now 410s — it stays a plain mark-as-read button
                     * with nowhere to send the user.
                     */}
                    {routerPath ? (
                      <Link
                        to={routerPath}
                        onClick={onVisit}
                        onKeyDown={activateOnSpace}
                        className={cn(rowClassName, 'block')}
                      >
                        {describe(notification)}
                      </Link>
                    ) : (
                      <button type="button" onClick={onVisit} className={rowClassName}>
                        {describe(notification)}
                      </button>
                    )}
                  </li>
                )
              })}
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
