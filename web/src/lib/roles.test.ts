import { describe, expect, it } from 'vitest'
import { hasRole, navItemsFor } from '@/lib/roles'

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
    const items = navItemsFor({ roles: [] })
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

  it('hides Find reviewers from an admin (S4)', () => {
    const items = navItemsFor({ roles: ['admin'] })
    expect(items.map((item) => item.label)).not.toContain('Find reviewers')
  })

  it('hides Find reviewers from a super_admin too', () => {
    const items = navItemsFor({ roles: ['super_admin'] })
    expect(items.map((item) => item.label)).not.toContain('Find reviewers')
  })

  it('shows Find reviewers to a member or coach', () => {
    expect(navItemsFor({ roles: ['member'] }).map((item) => item.label)).toContain('Find reviewers')
    expect(navItemsFor({ roles: ['coach'] }).map((item) => item.label)).toContain('Find reviewers')
  })
})
