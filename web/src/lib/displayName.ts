import type { CurrentUser } from '@/features/auth/types'

/**
 * D3 (PLAN-APP-HEADER.md) — the display-name fallback chain, one
 * implementation used everywhere a name needs deriving (the header, the
 * user menu, the sidebar's mobile duplicate) rather than one near-duplicate
 * per call site. All three name fields are nullable, and a mid-onboarding
 * user has all three null — `email` is the only field guaranteed non-null
 * on `/api/me`.
 *
 * `display_name` itself already folds in the
 * `first_name`/`last_name`/username-less cases server-side (see
 * `UserResource`'s expression), so this chain only needs to fall back past
 * it to `username`, then `email`.
 */
export function displayNameFor(user: Pick<CurrentUser, 'display_name' | 'username' | 'email'>): string {
  if (user.display_name && user.display_name.trim()) return user.display_name.trim()
  if (user.username) return user.username
  return user.email
}

/** Initials derived from the same chain — one or two characters, upper
 * cased. Falls back to the first character of the email for a user with
 * no name and no username at all (demo-script step 9's mid-onboarding
 * case). */
export function initialsFor(user: Pick<CurrentUser, 'display_name' | 'username' | 'email'>): string {
  const name = displayNameFor(user)
  const parts = name.trim().split(/\s+/).filter(Boolean)

  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  }
  // A single "word" (username, or the email fallback) — one character,
  // per D3: "falling back to the first character of the email."
  return (parts[0] ?? name).charAt(0).toUpperCase()
}
