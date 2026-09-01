import type { CurrentUser } from '@/features/auth/types'

/**
 * Matched against the real backend (`api/app/Http/Controllers/Api/
 * OnboardingController.php`, `ProfileController.php`, `AvatarController.php`,
 * `PublicProfileResource.php`, `Support/Onboarding.php`).
 */

/**
 * `GET /api/onboarding` — `App\Support\Onboarding::currentStep` derives
 * the step from which columns are already populated (no dedicated
 * step-tracking column), so there is nothing here to "resume" beyond
 * "start rendering at this step": 1 = name+username, 2 = bio/pronouns/
 * location, 3 = avatar, 4 = done. Each step is atomic (all its fields are
 * required together), so a step still in progress has never partially
 * written its own fields — there is no partial-step data to prefill.
 */
export interface OnboardingStatus {
  step: 1 | 2 | 3 | 4
  user: CurrentUser
}

export interface OnboardingStep1Payload {
  first_name: string
  last_name: string
  username: string
}

export interface OnboardingStep2Payload {
  bio: string
  pronouns: string
  location: string
}

/** Editable via `PATCH /api/profile` (`UpdateProfileRequest`) — every
 * field is `sometimes`+`nullable` server-side. */
export interface ProfileEditPayload {
  display_name?: string
  bio?: string
  pronouns?: string
  location?: string
}

/** `App\Http\Resources\PublicProfileResource` — the `/api/u/{username}`
 * payload. Identity only (§12 S1's deliberate stub).
 *
 * `credential` is STEP-12-FROZEN-CONTRACT.md §9's addition — confirmed by
 * that review that `PublicProfileResource` carries no role/credential
 * field today, same `getRoleNames()->first()` shape
 * `ReviewerDirectoryEntry.credential` already uses (`features/review/
 * types.ts`), so the profile page and the directory can never disagree
 * about what "Coach" means. Optional here (not every backend build has
 * landed the field yet) — `PublicProfile.tsx` treats a missing value the
 * same as `'member'`, i.e. no badge. */
export interface PublicProfile {
  /** STEP-13: added so `POST /api/connections` has a target id to send —
   * confirmed missing (and the Connect button unreachable without it) by
   * the STEP-13 reconciliation audit. */
  id: number
  username: string
  display_name: string | null
  pronouns: string | null
  bio: string | null
  location: string | null
  avatar_url: string | null
  credential?: string
}

export interface UsernameAvailability {
  available: boolean
}
