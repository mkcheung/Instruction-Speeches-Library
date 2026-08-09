import { describe, expect, it } from 'vitest'
import { colorFromId, hueFromId } from '@/lib/colorFromId'

describe('colorFromId', () => {
  it('is deterministic for the same id', () => {
    expect(hueFromId('01ABC')).toBe(hueFromId('01ABC'))
    expect(colorFromId('01ABC')).toBe(colorFromId('01ABC'))
  })

  it('produces a hue within [0, 360)', () => {
    for (const id of ['01ABC', 'a-very-different-ulid', '', 'x']) {
      const hue = hueFromId(id)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('differs across (most) different ids', () => {
    expect(hueFromId('01ABC')).not.toBe(hueFromId('01DEF'))
  })
})
