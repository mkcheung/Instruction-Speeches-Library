import type { Friend } from '@/features/connection/types'
import type { Notification } from '@/features/notification/types'
import type { Review } from '@/features/review/types'

/** One entry in the profile page's feed. `key` is stable across refetches
 * so an answered request can keep its place after the server drops it. */
export type FeedItem =
  | { kind: 'friend'; key: string; at: string; friend: Friend }
  | { kind: 'review'; key: string; at: string; review: Review }
  | { kind: 'commentary'; key: string; at: string; notification: Notification }

export function newestFirst(a: FeedItem, b: FeedItem): number {
  return Date.parse(b.at) - Date.parse(a.at)
}

/**
 * The feed has no endpoint of its own; it merges three that exist:
 * incoming friend requests (`/api/friends?view=incoming`), review
 * invitations still waiting for an answer (`/api/reviews`, `invited`), and
 * "a reviewer published commentary" notifications (`/api/notifications`).
 * Each source is its first page only, so the feed shows recent activity
 * rather than a complete history.
 */
export function buildFeed(friendRequests: Friend[], invitations: Review[], notifications: Notification[]): FeedItem[] {
  const items: FeedItem[] = []
  for (const friend of friendRequests) {
    if (friend.requested_at) items.push({ kind: 'friend', key: `friend-${friend.connection_id}`, at: friend.requested_at, friend })
  }
  for (const review of invitations) {
    if (isWaiting(review)) {
      items.push({ kind: 'review', key: `review-${review.id}`, at: review.invited_at ?? review.last_transition_at, review })
    }
  }
  for (const notification of notifications) {
    if (notification.data.type === 'review.published') {
      items.push({ kind: 'commentary', key: `commentary-${notification.id}`, at: notification.created_at, notification })
    }
  }
  return items.sort(newestFirst)
}

/** Requests that still need an answer, for the Feed tab's badge. */
export function waitingCount(friendRequestTotal: number, invitations: Review[]): number {
  return friendRequestTotal + invitations.filter(isWaiting).length
}

/** An invitation the feed lists and the badge counts: still waiting for an answer. */
function isWaiting(review: Review): boolean {
  return review.status === 'invited'
}
