import { describe, expect, it } from 'vitest'
import { onboardingStep2Schema, profileTextSchema } from './validation'

describe('shared profile text constraints', () => {
  it('keeps all fields empty-string compatible during skippable onboarding', () => {
    const empty = { bio: '', pronouns: '', location: '' }
    expect(profileTextSchema.parse(empty)).toEqual(empty)
    expect(onboardingStep2Schema.parse(empty)).toEqual(empty)
  })

  it.each([
    ['bio', 1000, 'Bio must be at most 1000 characters.'],
    ['pronouns', 32, 'Pronouns must be at most 32 characters.'],
    ['location', 80, 'Location must be at most 80 characters.'],
  ] as const)('preserves the %s boundary and exact form error', (field, maximum, message) => {
    const values = { bio: '', pronouns: '', location: '', [field]: 'x'.repeat(maximum) }
    expect(profileTextSchema.safeParse(values).success).toBe(true)
    const result = onboardingStep2Schema.safeParse({ ...values, [field]: 'x'.repeat(maximum + 1) })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues).toMatchObject([{ path: [field], message }])
  })
})
