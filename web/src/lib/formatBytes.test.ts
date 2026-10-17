import { describe, expect, it } from 'vitest'
import { formatBytes } from '@/lib/formatBytes'

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats a value under the first boundary with zero decimals', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('crosses the 1024 B -> KiB boundary', () => {
    // floor(log(1024, 1024)) === 1, not 0 — this is the exact boundary the
    // PHP port must cross the same way.
    expect(formatBytes(1024)).toBe('1.0 KiB')
  })

  it('formats just under the KiB boundary as bytes', () => {
    // 1023's integer part is 4 digits — `number_format` (the PHP side this
    // ports) adds a thousands separator there too, even at zero decimals.
    expect(formatBytes(1023)).toBe('1,023 B')
  })

  it('formats a mid-range KiB value with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KiB')
  })

  it('crosses the KiB -> MiB boundary', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MiB')
  })

  it('crosses the MiB -> GiB boundary', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GiB')
  })

  it('formats a GiB-scale value matching the 5 GiB default quota', () => {
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GiB')
  })

  it('formats a value just under the 5 GiB default quota', () => {
    expect(formatBytes(5 * 1024 * 1024 * 1024 - 1024 * 1024)).toBe('5.0 GiB')
  })

  it('crosses the GiB -> TiB boundary', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TiB')
  })

  it('caps at TiB for a value beyond it', () => {
    // 1024 TiB's integer part is 4 digits — `number_format` (the PHP side
    // this ports) adds a thousands separator there, so the port must too.
    expect(formatBytes(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1,024.0 TiB')
  })
})
