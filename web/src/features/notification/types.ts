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

export interface Notification {
  id: string
  type: NotificationType | string
  data: {
    type: NotificationType | string
    review_id?: number
    speech_id?: number
    speech_title?: string
    actor_name?: string
  }
  read_at: string | null
  created_at: string
}

export interface NotificationListResponse {
  notifications: Notification[]
  unread_count: number
}
