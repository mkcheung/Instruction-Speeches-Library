import { describe, expect, it } from 'vitest'
import { canRecordVoiceForRoles } from '@/lib/voiceRoles'

describe('canRecordVoiceForRoles', () => {
  it('shows recording only to a Coach without an administrative role', () => {
    expect(canRecordVoiceForRoles(['coach'])).toBe(true)
    expect(canRecordVoiceForRoles(['member'])).toBe(false)
    expect(canRecordVoiceForRoles(['coach', 'admin'])).toBe(false)
    expect(canRecordVoiceForRoles(['coach', 'super_admin'])).toBe(false)
  })
})
