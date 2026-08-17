import { describe, expect, it } from 'vitest'
import { displayNameFor, initialsFor } from '@/lib/displayName'

describe('displayNameFor', () => {
  it('prefers display_name when set', () => {
    expect(
      displayNameFor({ display_name: 'Marsy', username: 'marscheung', email: 'mars@example.com' }),
    ).toBe('Marsy')
  })

  it('falls back to username when display_name is empty', () => {
    expect(displayNameFor({ display_name: '', username: 'marscheung', email: 'mars@example.com' })).toBe(
      'marscheung',
    )
  })

  it('falls back to email when display_name and username are both null/empty', () => {
    expect(displayNameFor({ display_name: '', username: null, email: 'mars@example.com' })).toBe(
      'mars@example.com',
    )
  })

  it('renders the email for a mid-onboarding user with all name fields null', () => {
    // display_name is always a string server-side (UserResource computes
    // it, never returns null) but can be empty for a user who has set
    // neither profile.display_name nor first/last name.
    expect(displayNameFor({ display_name: '', username: null, email: 'new-user@example.com' })).toBe(
      'new-user@example.com',
    )
  })
})

describe('initialsFor', () => {
  it('takes first+last initial from a two-word display name', () => {
    expect(initialsFor({ display_name: 'Mars Cheung', username: null, email: 'm@example.com' })).toBe('MC')
  })

  it('takes one character from a single-word username fallback', () => {
    expect(initialsFor({ display_name: '', username: 'marscheung', email: 'm@example.com' })).toBe('M')
  })

  it('falls back to the first character of the email for a fully null-name user', () => {
    expect(initialsFor({ display_name: '', username: null, email: 'zed@example.com' })).toBe('Z')
  })
})
