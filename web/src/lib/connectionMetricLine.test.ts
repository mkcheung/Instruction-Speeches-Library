import { describe, expect, it } from 'vitest'
import { connectionMetricLine, formatMonthYear } from '@/lib/connectionMetricLine'

describe('connectionMetricLine', () => {
  it('passes through the backend-precomputed metric string unchanged', () => {
    expect(connectionMetricLine({ metric: '6 reviews together', connected_at: '2026-03-15T00:00:00Z' })).toBe(
      '6 reviews together',
    )
    expect(connectionMetricLine({ metric: 'Wants to connect', connected_at: null })).toBe('Wants to connect')
  })

  it('falls back to "Connected {Month Year}" — never "0 reviews" — when metric is missing', () => {
    const line = connectionMetricLine({ connected_at: '2026-03-15T00:00:00Z' })
    expect(line).toBe('Connected Mar 2026')
    expect(line).not.toMatch(/0 review/i)
  })

  it('falls back to a bare "Connected" when metric and connected_at are both missing', () => {
    expect(connectionMetricLine({ connected_at: null })).toBe('Connected')
  })
})

describe('formatMonthYear', () => {
  it('formats as "Mon YYYY"', () => {
    expect(formatMonthYear('2026-03-15T00:00:00Z')).toBe('Mar 2026')
  })
})
