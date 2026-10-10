import { describe, expect, it } from 'vitest'
import { ADMIN_PANEL_ITEM, getPostLoginDestination, hasRole, navItemsFor } from '@/lib/roles'

describe('hasRole', () => {
  it('is false for a user with roles: []', () => {
    expect(hasRole({ roles: [] }, 'admin')).toBe(false)
    expect(hasRole({ roles: [] }, 'member')).toBe(false)
  })

  it('is false for undefined/null user', () => {
    expect(hasRole(undefined, 'admin')).toBe(false)
    expect(hasRole(null, 'admin')).toBe(false)
  })

  it('treats super_admin as admin for navigation (P3)', () => {
    expect(hasRole({ roles: ['super_admin'] }, 'admin')).toBe(true)
  })

  it('matches a plain role', () => {
    expect(hasRole({ roles: ['member'] }, 'member')).toBe(true)
    expect(hasRole({ roles: ['coach'] }, 'admin')).toBe(false)
  })
})

describe('navItemsFor', () => {
  it('returns the complete baseline sidebar for roles: [] — the state every real user is in (S3)', () => {
    const items = navItemsFor({ roles: [], username: 'marscheung' })
    const labels = items.map((item) => item.label)
    expect(labels).toContain('My reviews')
    expect(labels).toContain('My speeches')
    expect(labels).toContain('Upload a speech')
    expect(labels).toContain('Edit profile')
    expect(labels).toContain('Find reviewers')
  })

  it('returns a non-empty list for an undefined user', () => {
    expect(navItemsFor(undefined).length).toBeGreaterThan(0)
  })

  // PLAN-ADMIN-DASHBOARD.md §7 — the first ADDITIVE admin branch in
  // `navItemsFor`. Before this, every role check in that function was
  // subtractive, so an admin's sidebar was strictly smaller than a
  // member's and nothing anywhere in the SPA linked to `/control-panel`.
  it('gives an admin an Admin panel link, as an EXTERNAL absolute URL', () => {
    const item = navItemsFor({ roles: ['admin'], username: 'e2e-admin' }).find((navItem) => navItem.label === 'Admin panel')

    expect(item).toBeDefined()
    // `external` is what makes the renderers emit a real anchor. Without
    // it, React Router would resolve the path against this SPA and render
    // the 404 page inside the app shell.
    expect(item?.external).toBe(true)
    expect(item?.to).toMatch(/^https?:\/\/.+\/control-panel$/)
  })

  it('gives a super_admin the Admin panel link too', () => {
    const labels = navItemsFor({
      roles: ['super_admin'],
      username: 'e2e-super-admin',
    }).map((item) => item.label)
    expect(labels).toContain('Admin panel')
  })

  it('never shows the Admin panel link to a member or coach', () => {
    expect(navItemsFor({ roles: [], username: 'milo' }).map((item) => item.label)).not.toContain('Admin panel')
    expect(navItemsFor({ roles: ['coach'], username: 'cora' }).map((item) => item.label)).not.toContain('Admin panel')
  })

  it('hides Find reviewers from an admin (S4)', () => {
    const items = navItemsFor({ roles: ['admin'], username: 'e2e-admin' })
    expect(items.map((item) => item.label)).not.toContain('Find reviewers')
  })

  it('hides Find reviewers from a super_admin too', () => {
    const items = navItemsFor({
      roles: ['super_admin'],
      username: 'e2e-super-admin',
    })
    expect(items.map((item) => item.label)).not.toContain('Find reviewers')
  })

  it('shows Find reviewers to a member or coach', () => {
    expect(navItemsFor({ roles: ['member'], username: 'e2e-member' }).map((item) => item.label)).toContain('Find reviewers')
    expect(navItemsFor({ roles: ['coach'], username: 'e2e-coach' }).map((item) => item.label)).toContain('Find reviewers')
  })

  it('shows Become a Coach to a plain member', () => {
    expect(navItemsFor({ roles: [], username: 'marscheung' }).map((item) => item.label)).toContain('Become a Coach')
    expect(navItemsFor({ roles: ['member'], username: 'e2e-member' }).map((item) => item.label)).toContain('Become a Coach')
  })

  it('hides Become a Coach from an existing coach', () => {
    expect(navItemsFor({ roles: ['coach'], username: 'e2e-coach' }).map((item) => item.label)).not.toContain('Become a Coach')
  })

  it('hides Become a Coach from an admin or super_admin', () => {
    expect(navItemsFor({ roles: ['admin'], username: 'e2e-admin' }).map((item) => item.label)).not.toContain('Become a Coach')
    expect(navItemsFor({ roles: ['super_admin'], username: 'e2e-super-admin' }).map((item) => item.label)).not.toContain('Become a Coach')
  })

  /**
   * The social page is reachable from the nav on every authenticated
   * route. Before this existed, the ONLY in-app link to `/u/:username`
   * was the onboarding "all set" card — which the redirect removed, so
   * without these items the whole social layer would be URL-only.
   */
  it('links a member to their own profile at /u/{username}', () => {
    const items = navItemsFor({ roles: ['member'], username: 'e2e-member' })
    expect(items.map((item) => item.label)).toContain('Your profile')
    expect(items.find((item) => item.label === 'Your profile')?.to).toBe('/u/e2e-member')
  })

  it('links a coach to their own profile too', () => {
    expect(navItemsFor({ roles: ['coach'], username: 'e2e-coach' }).map((item) => item.label)).toContain('Your profile')
  })

  /** `roles: []` is the normal state for every self-registered user, so
   * this is the case that actually matters in production. */
  it('links a roleless user to their own profile', () => {
    expect(navItemsFor({ roles: [], username: 'marscheung' }).map((item) => item.label)).toContain('Your profile')
  })

  it('hides Your profile from an admin or super_admin', () => {
    expect(navItemsFor({ roles: ['admin'], username: 'e2e-admin' }).map((item) => item.label)).not.toContain('Your profile')
    expect(navItemsFor({ roles: ['super_admin'], username: 'e2e-super-admin' }).map((item) => item.label)).not.toContain('Your profile')
  })

  /** `username` is null until onboarding step 1 completes; `/u/null` is
   * not a page. */
  it('omits Your profile when the user has no username yet', () => {
    expect(navItemsFor({ roles: [], username: null }).map((item) => item.label)).not.toContain('Your profile')
    expect(navItemsFor(undefined).map((item) => item.label)).not.toContain('Your profile')
  })

  it('keeps Your profile distinct from the Edit profile settings form', () => {
    const items = navItemsFor({ roles: [], username: 'marscheung' })
    const labels = items.map((item) => item.label)
    expect(labels).toContain('Your profile')
    expect(labels).toContain('Edit profile')
    expect(items.find((item) => item.label === 'Edit profile')?.to).toBe('/profile')
  })
})

/**
 * PLAN-ADMIN-LOGIN-REDIRECT.md §7.4 — the resolved Q2's full truth table.
 * The three "rejected" rows (admin+from, suspended) encode the resolution
 * itself and must not be dropped as redundant with the plainer cases.
 */
describe('getPostLoginDestination', () => {
  it('sends an admin with no `from` to the panel — the feature', () => {
    const destination = getPostLoginDestination({ roles: ['admin'], onboarding_completed: true }, undefined)
    expect(destination).toEqual({ to: ADMIN_PANEL_ITEM.to, external: true })
  })

  it('sends a super_admin with no `from` to the panel too', () => {
    const destination = getPostLoginDestination({ roles: ['super_admin'], onboarding_completed: true }, undefined)
    expect(destination).toEqual({ to: ADMIN_PANEL_ITEM.to, external: true })
  })

  /**
   * The shared-link rule, and the case that decides the whole resolution:
   * a role check ordered ahead of the `from` lookup would silently eat an
   * admin's deep link, the same way `RequireAuth` preserves one for every
   * other role.
   */
  it('an admin WITH a `from` destination lands there — NOT the panel', () => {
    const destination = getPostLoginDestination({ roles: ['admin'], onboarding_completed: true }, '/speeches/123')
    expect(destination).toEqual({ to: '/speeches/123', external: false })
  })

  it('sends a coach with no `from` to the dashboard', () => {
    const destination = getPostLoginDestination({ roles: ['coach'], onboarding_completed: true }, undefined)
    expect(destination).toEqual({ to: '/dashboard', external: false })
  })

  it('sends a member with no `from` to the dashboard', () => {
    const destination = getPostLoginDestination({ roles: ['member'], onboarding_completed: true }, undefined)
    expect(destination).toEqual({ to: '/dashboard', external: false })
  })

  it('sends a roleless user to onboarding, not the dashboard, when onboarding is incomplete', () => {
    const destination = getPostLoginDestination({ roles: [], onboarding_completed: false }, undefined)
    expect(destination).toEqual({ to: '/onboarding', external: false })
  })

  it('sends a roleless user with completed onboarding to the dashboard', () => {
    const destination = getPostLoginDestination({ roles: [], onboarding_completed: true }, undefined)
    expect(destination).toEqual({ to: '/dashboard', external: false })
  })

  it('treats an undefined user as roleless, not admin', () => {
    const destination = getPostLoginDestination(undefined, undefined)
    expect(destination).toEqual({ to: '/onboarding', external: false })
  })

  it('a `from` destination wins over every other rule, admin or not', () => {
    expect(getPostLoginDestination(undefined, '/speeches/123')).toEqual({ to: '/speeches/123', external: false })
    expect(getPostLoginDestination({ roles: ['member'], onboarding_completed: true }, '/speeches/123')).toEqual({
      to: '/speeches/123',
      external: false,
    })
  })
})
