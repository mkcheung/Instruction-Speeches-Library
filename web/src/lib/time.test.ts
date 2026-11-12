import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCalendarDate } from '@/lib/time'

describe('formatCalendarDate', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each(['2026-10-19', '2026-10-19 00:00:00', '2026-10-19T00:00:00Z'])('formats %s as its calendar day', (value) => {
    expect(formatCalendarDate(value)).toBe('October 19, 2026')
  })

  it('keeps a year below 100 as written', () => {
    expect(formatCalendarDate('0044-03-15')).toBe('March 15, 44')
  })

  it.each([null, '', 'not a date', '2026-13-45', '2026-02-30', '2026-04-31', '2026-02-29'])('returns null for %s', (value) => {
    expect(formatCalendarDate(value)).toBeNull()
  })

  it('keeps a real leap day', () => {
    expect(formatCalendarDate('2028-02-29')).toBe('February 29, 2028')
  })

  // CI runs in UTC, where `new Date('2026-10-19')` already shows the 19th —
  // only a zone west of UTC exposes the day-early bug this helper replaced.
  it('keeps the stored day west of UTC', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(formatCalendarDate('2026-10-19')).toBe('October 19, 2026')
  })
})
