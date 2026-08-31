import { FileText, GraduationCap, Home, Search, Shield, Upload, User, type LucideIcon } from 'lucide-react'
import type { CurrentUser } from '@/features/auth/types'

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

/** The nav-item list for a given user — baseline items always present,
 * `Find reviewers` added unless the user is an admin (S4), `Become a
 * Coach` added unless the user is already a coach or an admin. Safe to
 * call with `roles: []`; it still returns the complete baseline list (S3's
 * own acceptance criterion). */
export function navItemsFor(user: Pick<CurrentUser, 'roles'> | undefined | null): NavItem[] {
  const items = [...BASELINE_NAV_ITEMS]
  if (!hasRole(user, 'admin')) {
    items.splice(2, 0, REVIEWER_DIRECTORY_ITEM)
  }
  if (!hasRole(user, 'admin') && !hasRole(user, 'coach')) {
    items.push(BECOME_A_COACH_ITEM)
  }
  return items
}
