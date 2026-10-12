/**
 * STEP-05-invitation-loop.md's "in-app notification bell", backed by
 * `App\Http\Controllers\Api\NotificationController` over Laravel's stock
 * `DatabaseNotification` rows. `data` matches whatever the dispatching
 * `App\Notifications\*` class's `toDatabase()` returns — `type` plus a
 * flat set of fields, no pre-rendered `message` string; the bell composes
 * its own copy from `type`/`actor_name`/`speech_title` client-side.
 */
export type NotificationType =
  | 'review.invited'
  | 'review.accepted'
  | 'review.declined'
  // STEP-12-FROZEN-CONTRACT.md §9's pinned notification `type` strings.
  | 'coach_application.approved'
  | 'coach_application.rejected'
  // STEP-15's `review.published` — a reviewer finished and published their
  // feedback, so the author gets notified with a link to it.
  | 'review.published'
  // STEP-15's admin-action notifications (control panel suspensions,
  // takedowns, deletions) — see §11.1 and CP-08's admin notice work.
  | 'speech.taken_down'
  | 'user.suspended'
  | 'user.deleted'
  // IMPLEMENTATION-PLANS.md §7.2.5: dispatched to the REVIEWER (never the
  // speaker) when their access is revoked, with or without a purge — the
  // one notification §7.2 ships; withdraw/abandon get none, since those
  // are the reviewer's own acts.
  | 'review.access_revoked'

export interface Notification {
  id: string
  type: NotificationType | string
  data: {
    type: NotificationType | string
    review_id?: number
    speech_id?: number | null
    // `| null`, not just `| undefined` — same reason as `url` below.
    // `ReviewAccepted`/`ReviewDeclined`/`ReviewPublished` send explicit
    // `'speech_title' => $speech?->title` and
    // `'actor_name' => $reviewer !== null ? trim(...) : null`, both real
    // `null` wire values once the speech/reviewer is gone, not absent keys.
    speech_title?: string | null
    actor_name?: string | null
    // §7.2.5's `ReviewAccessRevoked` payload — `reason` is the speaker's
    // revocation reason (required on a first revoke, so only truly absent
    // on older/differently-shaped rows); `purged` distinguishes a plain
    // revoke from revoke-and-purge, since the two get different copy.
    reason?: string | null
    purged?: boolean
    // STEP-15: the backend now emits a navigable `url` on every
    // notification's payload, not just new types — optional because
    // older rows (and any type we haven't accounted for) may lack it.
    // `| null`, not just `| undefined`: several notification classes
    // (ReviewAccepted, ReviewDeclined, ReviewPublished) send an explicit
    // `'url' => null` when the speech has since been deleted — a real
    // wire value, not an absent key.
    url?: string | null
  }
  read_at: string | null
  created_at: string
}

export interface NotificationListResponse {
  notifications: Notification[]
  unread_count: number
}
