import { FileText, GraduationCap, Home, Search, Shield, Upload, User, UserRound, type LucideIcon } from 'lucide-react'
import type { CurrentUser } from '@/features/auth/types'
import { API_URL } from '@/lib/api'

/**
 * S3 (PLAN-APP-HEADER.md) — role logic is additive only. Registration
 * assigns no role (P1), so `roles: []` is the *normal* case for every
 * real user, not an edge case. Baseline nav items render unconditionally;
 * a role may only ADD an item (or, for `viewDirectory`, remove the one
 * item S4 covers) — never gate the whole list.
 *
 * `super_admin` is treated as `admin` for navigation (P3): every
 * authorization check in the backend is `hasRole('admin')` specifically,
 * Spatie applies no hierarchy, and `super_admin` is otherwise inert — so
 * routing it through the same admin branch here is consistent with "what
 * RBAC actually is in this codebase," not a shortcut.
 */
export function hasRole(user: Pick<CurrentUser, 'roles'> | undefined | null, role: string): boolean {
  if (!user) return false
  if (role === 'admin') {
    return user.roles.includes('admin') || user.roles.includes('super_admin')
  }
  return user.roles.includes(role)
}

export interface NavItem {
  label: string
  to: string
  /** Only the index-style routes need `end` on `NavLink` to avoid
   * `/speeches` lighting up for `/speeches/new` and `/speeches/:id` too. */
  end?: boolean
  /** Defined alongside the route it belongs to — a route with no icon here
   * just renders without one, rather than needing a second, string-keyed
   * table (`AppSidebar`'s old `ICONS` map) kept in sync by hand. */
  icon: LucideIcon
  /**
   * PLAN-ADMIN-DASHBOARD.md §7. `to` is normally a client-side route fed
   * straight to `<NavLink>`/`<Link>`, but the admin panel is NOT part of
   * this SPA: it is a server-rendered Filament panel on the API origin.
   * A `<NavLink to="/control-panel">` would hand the path to React
   * Router, which has no such route, and render a 404 inside the app
   * shell — so the destination needs to be an absolute URL on a real
   * anchor instead. Flagged per item rather than inferred from `to`
   * starting with `http`, so the two renderers opt in explicitly.
   */
  external?: boolean
}

/**
 * S2's verified inventory of destinations that exist today, unconditional
 * for every authenticated user regardless of role — S3's rule made literal.
 */
const BASELINE_NAV_ITEMS: NavItem[] = [
  { label: 'My reviews', to: '/dashboard', icon: Home },
  { label: 'My speeches', to: '/speeches', end: true, icon: FileText },
  { label: 'Upload a speech', to: '/speeches/new', icon: Upload },
  // STEP-09-FROZEN-CONTRACT.md §5: `/search` is a new top-level,
  // unconditional destination (search is over the CURRENT user's own
  // speeches only, so there's no role-gating question the way "Find
  // reviewers" has).
  { label: 'Search', to: '/search', icon: Search },
  { label: 'Edit profile', to: '/profile', icon: User },
  // STEP-11-FROZEN-CONTRACT.md §10: export/deletion is an unconditional
  // destination — every authenticated user owns their own data regardless
  // of role, same reasoning as `/profile`.
  { label: 'Account & privacy', to: '/account', icon: Shield },
]

/**
 * S4 — "Find reviewers" is the one genuinely role-differentiated item:
 * visible to everyone except admins, once `viewDirectory` is wired
 * server-side. Inserted after "My speeches" to sit beside the other
 * discovery/action items rather than at the very end.
 */
const REVIEWER_DIRECTORY_ITEM: NavItem = { label: 'Find reviewers', to: '/reviewers', icon: Search }

/**
 * STEP-12-FROZEN-CONTRACT.md §9 — reachable CTA for a Member who isn't
 * already a coach. Hidden for existing coaches (nothing left to apply
 * for) and admins (they moderate applications in Filament, they don't
 * submit them), mirroring `REVIEWER_DIRECTORY_ITEM`'s own admin-hiding
 * precedent one item below.
 */
const BECOME_A_COACH_ITEM: NavItem = { label: 'Become a Coach', to: '/become-a-coach', icon: GraduationCap }

/**
 * PLAN-ADMIN-DASHBOARD.md §7 — the admin panel, which lives OUTSIDE this
 * SPA (a server-rendered Filament panel mounted at `/control-panel` on the
 * API origin, guarded by `EnsureUserIsAdmin` + mandatory TOTP).
 *
 * Absolute, built from `API_URL`, because the SPA and the panel are served
 * from different hosts in every environment — `app.` vs `api.` in
 * dev/e2e. Hardcoding `/control-panel` would resolve against the SPA's own
 * origin and 404.
 *
 * `external: true` is what makes the two renderers emit a real `<a>`
 * instead of a React Router link; see the field's own docblock.
 */
export const ADMIN_PANEL_ITEM: NavItem = {
  label: 'Admin panel',
  to: `${API_URL}/control-panel`,
  icon: Shield,
  external: true,
}

/**
 * The public profile — the app's social surface (connections rail,
 * profile timeline, arc strip). Not in `BASELINE_NAV_ITEMS` because its
 * `to` is per-user (`/u/:username`) rather than a fixed path, and because
 * it is the one item that can be unavailable for a non-role reason:
 * `username` is null until onboarding step 1 completes.
 *
 * Hidden from admins for the same reason as `BECOME_A_COACH_ITEM` —
 * `ConnectionPolicy` holds that an admin never acts as a party to a
 * connection, so a personal social page is not part of their job.
 *
 * Distinct from `Edit profile` (`/profile`), which is the settings form,
 * not the page other people see.
 */
function profileItemFor(username: string): NavItem {
  return { label: 'Your profile', to: `/u/${username}`, icon: UserRound }
}

/** The nav-item list for a given user — baseline items always present,
 * `Find reviewers` added unless the user is an admin (S4), `Your profile`
 * added unless the user is an admin or has no username yet, `Become a
 * Coach` added unless the user is already a coach or an admin. Safe to
 * call with `roles: []`; it still returns the complete baseline list (S3's
 * own acceptance criterion). */
export function navItemsFor(
  user: Pick<CurrentUser, 'roles' | 'username'> | undefined | null,
): NavItem[] {
  const items = [...BASELINE_NAV_ITEMS]
  if (!hasRole(user, 'admin')) {
    items.splice(2, 0, REVIEWER_DIRECTORY_ITEM)
  }
  // Sits next to `Edit profile` rather than at the end: the two are the
  // "me" pair, one the page others see and one the form that edits it.
  if (user?.username && !hasRole(user, 'admin')) {
    const editProfileIndex = items.findIndex((item) => item.to === '/profile')
    items.splice(editProfileIndex, 0, profileItemFor(user.username))
  }
  if (!hasRole(user, 'admin') && !hasRole(user, 'coach')) {
    items.push(BECOME_A_COACH_ITEM)
  }
  // PLAN-ADMIN-DASHBOARD.md §7, and the FIRST additive admin branch in
  // this function. Every other role check above is subtractive, which is
  // how the shipped state ended up with an admin's sidebar being strictly
  // SMALLER than a member's — and with no route to their own panel from
  // anywhere in the app (`grep -rn "control-panel" web/` returned zero
  // hits). PLAN-APP-HEADER.md:344 specified exactly this line
  // (`if (roles.includes('admin')) add(adminItems)`) and STEP-12 shipped
  // the panel without it.
  //
  // Last in the list on purpose: it leaves the SPA entirely, so it should
  // not sit among the in-app destinations.
  if (hasRole(user, 'admin')) {
    items.push(ADMIN_PANEL_ITEM)
  }
  return items
}

/** What `getPostLoginDestination` returns — `external` is what tells a
 * call site whether it can hand `to` to `navigate()` or must perform a
 * real cross-origin navigation instead (see `NavItem.external`'s own
 * docblock for why the two cannot be treated the same). */
export interface PostLoginDestination {
  to: string
  external: boolean
}

/**
 * PLAN-ADMIN-LOGIN-REDIRECT.md §7.1/§7.3 (the resolved Q2) — where an
 * authenticated user lands, shared between site 1 (`Login.tsx`'s
 * post-mutation callback) and site 2 (`AuthShell.tsx`'s `RequireGuest`,
 * a render-phase guard). One definition, one place to test (§7.4).
 *
 * Three rules, in priority order, and the first is the one that decides
 * most cases:
 *
 * 1. **A specific destination always wins.** If `from` is set — the user
 *    followed a link, was bounced to `/login` by `RequireAuth`, and
 *    signed in — they land there. Shared links must survive, and a role
 *    check ordered ahead of this would silently eat them.
 * 2. **A plain sign-in with no destination escorts an admin to the
 *    panel.** That is the feature this helper exists to add.
 * 3. **Otherwise, the ordinary onboarding/dashboard landing.**
 *
 * Deliberately NOT special-cased for a suspended admin (§7.3 names the
 * risk: `CheckUserIsActive` runs before the login controller, so a
 * suspended account's `POST /login` still returns 200 with `roles` in the
 * body, and this helper would send them cross-origin to a bare Blade
 * suspension page with no Back). There is no field on `CurrentUser` that
 * could tell this helper that — `UserResource` carries no suspension
 * state, and changing it is explicitly out of scope for this plan. The
 * same failure mode already exists for `ADMIN_PANEL_ITEM`'s own nav link,
 * which this helper does not make any worse; closing it for real needs a
 * backend contract change, not a frontend workaround.
 */
export function getPostLoginDestination(
  user: Pick<CurrentUser, 'roles' | 'onboarding_completed'> | undefined | null,
  from?: string,
): PostLoginDestination {
  if (from) {
    return { to: from, external: false }
  }
  if (hasRole(user, 'admin')) {
    return { to: ADMIN_PANEL_ITEM.to, external: true }
  }
  return { to: user?.onboarding_completed ? '/dashboard' : '/onboarding', external: false }
}
