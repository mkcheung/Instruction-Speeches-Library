/**
 * The identity HTTP contract, matched against the real backend
 * (`api/routes/api.php`, `api/routes/web.php`, `api/app/Http/Resources/UserResource.php`,
 * `api/app/Http/Responses/Fortify/*`, `api/app/Actions/Fortify/CreateNewUser.php`)
 * once it landed — this superseded an earlier guessed contract written
 * before the backend existed.
 */

/** `App\Http\Resources\UserResource` — deliberately thin; profile fields
 * (bio, pronouns, location, avatar) are never on this shape, only on
 * `PublicProfileResource` (see `features/profile/types.ts`). */
export interface CurrentUser {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  username: string | null
  /** `profile.display_name` if set, else `"{first_name} {last_name}".trim()`
   * — same expression `PublicProfileResource` computes, so the header and
   * `/profile` can never disagree about a user's name. */
  display_name: string
  email_verified: boolean
  roles: string[]
  onboarding_completed: boolean
  /** 1 = name+username, 2 = bio/pronouns/location, 3 = avatar, 4 = done. */
  onboarding_step: 1 | 2 | 3 | 4
}

/** `GET /api/me` — the session probe every route guard reads. */
export interface MeResponse {
  user: CurrentUser
}

/**
 * Registration deliberately collects only email + password
 * (`CreateNewUser`) — names and username are gathered at onboarding step 1,
 * not here.
 */
export interface RegisterPayload {
  email: string
  password: string
  password_confirmation: string
}

export interface LoginPayload {
  email: string
  password: string
  remember?: boolean
}

export interface ForgotPasswordPayload {
  email: string
}

export interface ResetPasswordPayload {
  token: string
  email: string
  password: string
  password_confirmation: string
}

/** Laravel's single validation-error shape (422), everywhere in this app. */
export interface ServerErrorResponse {
  message?: string
  errors?: Record<string, string[]>
}
