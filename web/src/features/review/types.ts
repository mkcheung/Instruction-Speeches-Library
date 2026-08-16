/**
 * STEP-05-invitation-loop.md (§6.3, §6.11, §7.5). Matched against the
 * real backend (`api/app/Http/Resources/ReviewResource.php`,
 * `ReviewerDirectoryResource.php`, `Controllers/Api/ReviewController.php`,
 * `ReviewerDirectoryController.php`). Field names are kept
 * snake_case-from-Laravel, same as `features/speech/types.ts` — this
 * codebase does not run a case converter, it types the JSON envelope
 * as-is.
 */
export type ReviewStatus = 'invited' | 'declined' | 'accepted' | 'in_progress' | 'published' | 'abandoned'

/** `App\Http\Resources\ReviewResource`. Deliberately thin — no raw
 * `speech_id`/`reviewer_id`/`speech_owner_id`/`invited_by_id`, no
 * `annotations_count` (those exist on the `Review` model but the resource
 * doesn't serialize them). `speech`/`reviewer` are conditionally included
 * via `whenLoaded`, so either can be `undefined` depending on which
 * endpoint returned this row. */
export interface Review {
  id: number
  status: ReviewStatus
  invitation_message: string | null
  allow_preview: boolean
  prior_commentary_shared: boolean
  invited_at: string | null
  responded_at: string | null
  first_published_at: string | null
  last_published_at: string | null
  last_transition_at: string
  revoked_at: string | null
  revocation_reason: string | null
  speech?: {
    id: number
    ulid: string
    title: string
    owner_name: string | null
  }
  reviewer?: {
    id: number
    username: string
    name: string
  } | null
}

/** `GET /api/reviews` (§7.5) — the server pre-splits into the dashboard's
 * four exact sections and returns whichever ones weren't narrowed out by
 * `?section=`; omitting the param (what `listMyReviews` below does)
 * returns all four in one call. Each section arrives already sorted the
 * way its dashboard column wants it — invited oldest-first, the rest
 * newest-first. */
export interface ReviewSections {
  invited?: Review[]
  in_progress?: Review[]
  published?: Review[]
  revoked?: Review[]
}

/** `GET /api/speeches/{speech}/reviews` — owner-only track-selector data;
 * pre-filtered server-side to access-granting, non-revoked reviews only. */
export interface SpeechReviewListResponse {
  reviews: Review[]
}

/** `App\Http\Resources\ReviewerDirectoryResource`. §6.3: with no open
 * reviewer pool, this directory is the only discovery mechanism.
 * `credential` is whatever role name the account holds (`getRoleNames()->
 * first()`) — typed loosely since the directory query itself is what
 * decides who's eligible to appear at all. */
export interface ReviewerDirectoryEntry {
  id: number
  username: string
  name: string
  credential: string
  avatar_url: string | null
}

export interface ReviewerDirectoryResponse {
  reviewers: ReviewerDirectoryEntry[]
  meta: { current_page: number; last_page: number; total: number }
}

/** `POST /api/speeches/{speech}/reviews` (`InviteReviewerRequest`) — the
 * request field is `message`, even though the resource that comes back
 * calls it `invitation_message`. `prior_commentary_shared` is only ever
 * sent `true` when the speech has a `supersedes` link — the invite
 * composer hides the opt-in otherwise. */
export interface InviteReviewerPayload {
  reviewer_id: number
  message?: string | null
  allow_preview: boolean
  prior_commentary_shared: boolean
}

/** `POST /api/reviews/{review}/revoke` (`RevokeReviewRequest`) — the only
 * action mutation that takes a body. */
export interface RevokeReviewPayload {
  reason?: string | null
}

/**
 * STEP-07-write-commentary.md's frozen contract (4): `POST /api/reviews
 * /{review}/publish` — publishes all of the caller's own draft rows in
 * that review, including the "publish-additions" case (safe to call again
 * after adding more; only publishes what's new). `published_count` is the
 * number newly published by THIS request, not the set's total — the demo
 * script's "press Publish, it shows a count" refers to this field. The
 * exact shape of `review` beyond the fields already on `Review` is not
 * pinned down by the frozen contract text; typed as the same `Review`
 * shape every other mutation in this file returns, since nothing suggests
 * otherwise — flag for the reconciliation pass if the real backend
 * response differs.
 */
export interface PublishReviewResponse {
  published_count: number
  review: Review
}
