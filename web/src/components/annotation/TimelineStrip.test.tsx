import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TimelineStrip } from './TimelineStrip'
import type { Annotation } from '@/features/annotation/types'
function note(overrides: Partial<Annotation> = {}): Annotation {
  return { id: '5', timing_type: 'range', start_seconds: 10, duration_seconds: 6, kind: 'observation', topic: null,
    body: 'Saved marker', lock_version: 1, client_uuid: 'u5', voice: null, ...overrides }
}
function strip(annotations: Annotation[], onSeek = vi.fn()) {
  return render(<TimelineStrip annotations={annotations} videoEl={null} durationSeconds={100} onSeek={onSeek} />)
}
describe('display and seek timeline', () => {
  it('exposes the named timeline as a group containing its unchanged seek controls', () => {
    strip([note(), note({ id: '6', timing_type: 'point', start_seconds: 25, duration_seconds: 0 })])
    const group = screen.getByRole('group', { name: 'Annotation timeline' })
    expect(group).toBe(screen.getByTestId('timeline-strip'))
    expect(within(group).getByRole('button', { name: /annotation at/i })).toBeVisible()
    expect(within(group).getByRole('button', { name: /voice note at/i })).toBeVisible()
    expect(within(group).getAllByRole('button')).toHaveLength(2)
  })
  it('seeks without exposing drag/resize or starting a mutation', () => {
    const onSeek = vi.fn(); const fetch = vi.spyOn(globalThis, 'fetch')
    strip([note()], onSeek)
    const marker = screen.getByRole('button', { name: /annotation at/i })
    fireEvent.pointerDown(marker, { clientX: 100 }); fireEvent.pointerMove(window, { clientX: 300 }); fireEvent.pointerUp(window)
    fireEvent.click(marker)
    expect(onSeek).toHaveBeenCalledWith(10)
    expect(screen.queryByTestId('marker-5-start-handle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('marker-5-duration-handle')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore()
  })
  it('renders erased points as point glyphs without using recording length as a span', () => {
    strip([note({ timing_type: 'point', duration_seconds: 90, voice: null })])
    const marker = screen.getByTestId('voice-marker-5')
    expect(marker).toHaveAccessibleName(/voice note at/i)
    expect(marker.style.width).toBe('')
    expect(screen.queryByTestId('range-marker-5')).not.toBeInTheDocument()
  })
  it('still renders historical audio points without the additive timing_type field', () => {
    strip([note({ timing_type: undefined, voice: { asset_id: 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null } })])
    expect(screen.getByRole('button', { name: /voice note at/i })).toBeVisible()
  })
  it('reserves room for both rows of grandfathered overlapping feedback', () => {
    strip([note(), note({ id: '6', start_seconds: 12 })])
    expect(screen.getByTestId('timeline-strip').style.height).toBe('3rem')
  })
  it('reserves one row for an empty track', () => {
    strip([]); expect(screen.getByTestId('timeline-strip').style.height).toBe('1.5rem')
  })
})
