import type { Speech } from '@/features/speech/types'

/**
 * STEP-13-social-layer.md / §6.7.2. Reconciled directly against the real
 * backend once it landed mid-build (`api/app/Http/Resources/
 * ConnectionResource.php`, `ConnectionController.php`,
 * `ProfileTimelineController.php`, `SpeechArcService.php`,
 * `2026_08_30_100001_create_connections_table.php`) — this file replaced
 * an earlier version written before the backend existed; see this build's
 * summary for the full list of guesses that turned out wrong (field names
 * `status`→`state`, `user`→`peer`, `message`→`note`, a precomputed
 * `metric` string rather than raw counts, `direction`→`tab`). The
 * `PublicProfileResource` missing-`id` gap and the missing pending-list
 * endpoint were both found by the STEP-13 reconciliation audit and fixed
 * afterward — `id` now exists on `PublicProfile`, and `GET
 * /api/connections?state=pending` lists incoming requests.
 */
export type ConnectionState = 'pending' | 'accepted' | 'declined' | 'blocked'

export interface ConnectionPeer {
  id: number
  username: string
  name: string
  avatar_url: string | null
}

/**
 * One mirrored `connections` row, from the CALLER's perspective — `peer`
 * is always "the other person." `metric` is only populated by
 * `ConnectionController::index` (the rail), computed server-side for the
 * whole page in one `GROUP BY` (R19) — §6.7.4's five-string table already
 * rendered; never recompute it client-side.
 */
export interface Connection {
  id: number
  state: ConnectionState
  initiated_by_id: number
  note: string | null
  requested_at: string | null
  responded_at: string | null
  connected_at: string | null
  peer?: ConnectionPeer
  metric?: string
}

/** `GET /api/connections` (default `?state=accepted`) or `GET
 * /api/connections?state=pending` (incoming requests only — the caller's
 * own self-initiated pending rows are excluded server-side). No
 * `meta.total` — only `next_cursor`. */
export interface ConnectionsRailResponse {
  connections: Connection[]
  meta: { next_cursor: string | null }
}

/** `POST /api/connections` (`CreateConnectionRequest`) — `user_id` is a
 * raw numeric id, now sourced from `PublicProfile.id`. */
export interface SendConnectionRequestPayload {
  user_id: number
  note?: string | null
}

export type ProfileTimelineTab = 'left' | 'received'

/** One `arc` entry (`SpeechArcService::chainFor`) — depth 1 is always the
 * speech this timeline row is actually about; higher depth is an older
 * ancestor via `supersedes_id`. Title/ulid/delivered_on/change_note are
 * `null` when `visible` is `false` — "shown that v2 exists never makes it
 * playable" (§6.11): render depth and existence only, never content, for
 * an entry the viewer holds no grant on. */
export interface ArcChainEntry {
  id: number
  ulid: string | null
  title: string | null
  delivered_on: string | null
  change_note: string | null
  depth: number
  visible: boolean
}

export interface ProfileTimelineItem {
  review_id: number
  status: string
  last_transition_at: string
  commentary: { notes_count: number; has_essay: boolean }
  speech: Pick<Speech, 'id' | 'ulid' | 'title' | 'delivered_on'> & { duration_seconds: string | null }
  poster: { url: string; width: number; height: number } | null
  arc: ArcChainEntry[] | null
}

export interface ProfileTimelineResponse {
  timeline: ProfileTimelineItem[]
  meta: { next_cursor: string | null; tab: ProfileTimelineTab; profile_username: string }
}
