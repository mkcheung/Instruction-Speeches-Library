import { describe, expect, it } from 'vitest'
import { cleanProfileField, profileFieldError } from './profileFieldRules'

describe('profile field rules', () => {
  it.each(['', '   '])('requires a display name (%j)', (draft) => {
    expect(profileFieldError('display_name', draft)).toBe('Display name is required.')
  })

  it('caps a trimmed display name at 60 characters', () => {
    expect(profileFieldError('display_name', ` ${'x'.repeat(60)} `)).toBeNull()
    expect(profileFieldError('display_name', 'x'.repeat(61))).toBe('Display name must be at most 60 characters.')
    expect(cleanProfileField('display_name', '  Milo M.  ')).toBe('Milo M.')
  })

  it.each([
    ['', 'Username is required.'],
    ['Milo M', 'Usernames cannot contain spaces.'],
    ['ab', 'Username must be at least 3 characters.'],
    ['-milo', 'Lowercase letters, numbers, "_", "." or "-" only; must start and end with a letter or number.'],
  ])('rejects the username %j', (draft, message) => {
    expect(profileFieldError('username', draft)).toBe(message)
  })

  it('accepts capitals and outer spaces in a username because they are saved lowercased and trimmed', () => {
    expect(profileFieldError('username', '  Milo-M ')).toBeNull()
    expect(cleanProfileField('username', '  Milo-M ')).toBe('milo-m')
  })

  it('keeps bio and location optional with their length caps', () => {
    expect(profileFieldError('bio', '')).toBeNull()
    expect(profileFieldError('location', '')).toBeNull()
    expect(profileFieldError('bio', 'x'.repeat(1001))).toBe('Bio must be at most 1000 characters.')
    expect(profileFieldError('location', 'x'.repeat(81))).toBe('Location must be at most 80 characters.')
    // Measured as the server will store it: trailing whitespace doesn't count against the cap.
    expect(profileFieldError('bio', `${'x'.repeat(1000)}\n`)).toBeNull()
    expect(cleanProfileField('bio', ' Line one\nLine two \n')).toBe('Line one\nLine two')
    expect(cleanProfileField('location', '  Home  ')).toBe('Home')
  })
})
