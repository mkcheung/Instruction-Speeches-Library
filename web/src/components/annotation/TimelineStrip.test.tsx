import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { TimelineStrip } from './TimelineStrip'
import type { Annotation } from '@/features/annotation/types'

function note(overrides: Partial<Annotation> = {}): Annotation {
  return { id: '5', timing_type: 'range', start_seconds: 10, duration_seconds: 6, kind: 'observation', topic: null,
    body: 'Saved marker', lock_version: 1, client_uuid: 'u5', voice: null, ...overrides }
}
const voice = { asset_id: 1, audio_status: 'ready' as const, transcript_status: 'ready' as const, failure_code: null }
const point = (overrides: Partial<Annotation> = {}) => note({ id: '6', timing_type: 'point', start_seconds: 25, duration_seconds: 0, voice, ...overrides })
type Props = Partial<React.ComponentProps<typeof TimelineStrip>>
function strip(annotations: Annotation[], props: Props = {}) {
  return render(<TimelineStrip annotations={annotations} videoEl={null} durationSeconds={100} onSeek={vi.fn()} {...props} />)
}
function fakeVideo(duration: number) {
  const el = document.createElement('video')
  Object.defineProperty(el, 'duration', { value: duration, configurable: true, writable: true })
  return el
}
const setDuration = (el: HTMLVideoElement, d: number) => { (el as unknown as { duration: number }).duration = d }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('labeled lanes', () => {
  it('renders Text and Voice lanes with markers in the right lane and named buttons', () => {
    strip([note(), point()])
    const group = screen.getByRole('group', { name: 'Annotation timeline' })
    expect(group).toBe(screen.getByTestId('timeline-strip'))
    expect(within(group).getByText('Text')).toBeVisible()
    expect(within(group).getByText('Voice')).toBeVisible()
    expect(within(screen.getByTestId('timeline-lane-text')).getByRole('button', { name: 'Text note from 10 seconds to 16 seconds' })).toBeVisible()
    expect(within(screen.getByTestId('timeline-lane-voice')).getByRole('button', { name: 'Voice note at 25 seconds' })).toBeVisible()
    expect(within(group).getAllByRole('button')).toHaveLength(2)
  })
  it('uses exact range geometry with no minimum-width inflation', () => {
    strip([note({ start_seconds: 10, duration_seconds: 0.5 })])
    const m = screen.getByTestId('range-marker-5')
    expect(m.style.left).toBe('10%'); expect(m.style.width).toBe('0.5%')
  })
  it('clamps ranges and points at the bounds', () => {
    strip([note({ start_seconds: 90, duration_seconds: 50 }), point({ start_seconds: 500 })])
    expect(screen.getByTestId('range-marker-5').style.width).toBe('10%')
    expect(screen.getByTestId('voice-marker-6').style.left).toBe('100%')
  })
  it('is safe for zero and unknown duration', () => {
    strip([note(), point()], { durationSeconds: 0 })
    expect(screen.getByTestId('timeline-strip').outerHTML).not.toMatch(/NaN|Infinity/)
    expect(screen.getByTestId('range-marker-5').style.width).toBe('0%')
    expect(screen.getByTestId('timeline-ticks')).toHaveTextContent('0:00')
  })
  it('shows start, middle and end ticks from the real duration', () => {
    strip([], { durationSeconds: 120 })
    expect(screen.getByTestId('timeline-ticks')).toHaveTextContent('0:001:002:00')
  })
})

describe('point classification', () => {
  it('keeps erased points as point glyphs and ignores recording length', () => {
    strip([note({ timing_type: 'point', duration_seconds: 90, voice: null })])
    const marker = screen.getByTestId('voice-marker-5')
    expect(marker).toHaveAccessibleName(/voice note at 10 seconds, audio unavailable/i)
    expect(marker.style.width).toBe('')
    expect(screen.queryByTestId('range-marker-5')).not.toBeInTheDocument()
  })
  it('renders historical audio points without timing_type', () => {
    strip([note({ timing_type: undefined, voice })])
    expect(screen.getByRole('button', { name: /voice note at/i })).toBeVisible()
  })
})

describe('subtracks', () => {
  it('gives overlapping ranges deterministic distinct subtracks beyond two', () => {
    strip([note({ id: 'c', start_seconds: 12 }), note({ id: 'a' }), note({ id: 'b', start_seconds: 11 })])
    const tops = ['a', 'b', 'c'].map((id) => screen.getByTestId(`range-marker-${id}`).style.top)
    expect(new Set(tops).size).toBe(3)
    expect(screen.getByTestId('timeline-lane-text').style.height).toBe('4.5rem')
  })
  it('reuses a subtrack for non-overlapping ranges', () => {
    strip([note({ id: 'a', start_seconds: 0, duration_seconds: 5 }), note({ id: 'b', start_seconds: 5, duration_seconds: 5 })])
    expect(screen.getByTestId('range-marker-a').style.top).toBe(screen.getByTestId('range-marker-b').style.top)
    expect(screen.getByTestId('timeline-lane-text').style.height).toBe('1.5rem')
  })
  it('separates colliding voice glyphs but not distant ones', () => {
    strip([point({ id: 'a', start_seconds: 20 }), point({ id: 'b', start_seconds: 20.1 }), point({ id: 'c', start_seconds: 80 })])
    expect(screen.getByTestId('voice-marker-a').style.top).not.toBe(screen.getByTestId('voice-marker-b').style.top)
    expect(screen.getByTestId('voice-marker-c').style.top).toBe(screen.getByTestId('voice-marker-a').style.top)
  })
  it('uses the measured axis width for glyph collision', () => {
    class RO { cb: () => void; constructor(cb: () => void) { this.cb = cb } observe() { this.cb() } disconnect() {} }
    vi.stubGlobal('ResizeObserver', RO)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100 } as DOMRect)
    strip([point({ id: 'a', start_seconds: 10 }), point({ id: "b", start_seconds: 30 })])
    expect(screen.getByTestId('voice-marker-a').style.top).not.toBe(screen.getByTestId('voice-marker-b').style.top)
  })
})

describe('drafts and selection', () => {
  it('marks temporary drafts with dashed edge and accessible wording', () => {
    strip([note({ id: 'tmp_1' })], { draftIds: ['tmp_1'] })
    const m = screen.getByTestId('draft-marker-tmp_1')
    expect(m).toHaveAccessibleName(/^Unsaved text draft from 10 seconds/)
    expect(m).toHaveClass('border-dashed', 'awt-marker--draft')
    expect(m).toHaveAttribute('data-temporary', 'true')
  })
  it('names a draft with an unset end readably', () => {
    strip([note({ id: 'tmp_1', duration_seconds: 0 })], { draftIds: new Set(['tmp_1']) })
    expect(screen.getByTestId('draft-marker-tmp_1')).toHaveAccessibleName(/end time not set/)
  })
  it('styles explicit selection independently of current highlighting', () => {
    strip([note(), note({ id: '7', start_seconds: 50 })], { selectedId: '5', activeIds: ['7'] })
    const sel = screen.getByTestId('range-marker-5'); const cur = screen.getByTestId('range-marker-7')
    expect(sel).toHaveAttribute('data-selected', 'true'); expect(sel).toHaveAccessibleName(/, selected$/)
    expect(sel).not.toHaveAttribute('data-current'); expect(sel).not.toHaveAttribute('aria-current')
    expect(cur).toHaveAttribute('aria-current', 'true'); expect(cur).toHaveAttribute('data-current', 'true'); expect(cur).not.toHaveAttribute('data-selected')
  })
})

describe('unknown duration and duplicate names', () => {
  it('keeps many voice notes and invalid ranges bounded, distinct and focusable at zero duration', () => {
    const voices = Array.from({ length: 12 }, (_, i) => point({ id: `v${i}`, start_seconds: i }))
    const ranges = Array.from({ length: 4 }, (_, i) => note({ id: `r${i}`, start_seconds: i, duration_seconds: 0 }))
    strip([...voices, ...ranges], { durationSeconds: 0 })
    expect(screen.getByTestId('timeline-lane-voice').style.height).toBe('1.75rem')
    expect(screen.getByTestId('timeline-lane-text').style.height).toBe('1.5rem')
    expect(new Set(voices.map((v) => screen.getByTestId(`voice-marker-${v.id}`).style.left)).size).toBe(12)
    expect(new Set(ranges.map((r) => screen.getByTestId(`range-marker-${r.id}`).style.left)).size).toBe(4)
    expect(screen.getAllByRole('button')).toHaveLength(16)
    expect(screen.getByTestId('timeline-strip').outerHTML).not.toMatch(/NaN|Infinity/)
  })
  it('numbers identical names within a lane only', () => {
    strip([point({ id: 'a' }), point({ id: 'b' }), point({ id: 'c', start_seconds: 60 }), note()])
    expect(screen.getByTestId('voice-marker-a')).toHaveAccessibleName('Voice note at 25 seconds, 1 of 2 with this name')
    expect(screen.getByTestId('voice-marker-b')).toHaveAccessibleName('Voice note at 25 seconds, 2 of 2 with this name')
    expect(screen.getByTestId('voice-marker-c')).toHaveAccessibleName('Voice note at 1 minute 0 seconds')
    expect(screen.getByTestId('range-marker-5')).toHaveAccessibleName('Text note from 10 seconds to 16 seconds')
  })
})

describe('activation', () => {
  it('seeks once and reports identity for every marker kind', () => {
    const onSeek = vi.fn(); const onMarkerActivate = vi.fn()
    const erased = note({ id: '8', timing_type: 'point', start_seconds: 70, voice: null })
    strip([note(), point(), erased, note({ id: 'tmp_1', start_seconds: 40 })], { onSeek, onMarkerActivate, draftIds: ['tmp_1'] })
    for (const id of ['range-marker-5', 'voice-marker-6', 'voice-marker-8', 'draft-marker-tmp_1']) fireEvent.click(screen.getByTestId(id))
    expect(onSeek.mock.calls.map((c) => c[0])).toEqual([10, 25, 70, 40])
    expect(onMarkerActivate.mock.calls.map(([a]) => [a.id, a.kind, a.temporary])).toEqual([
      ['5', 'text', false], ['6', 'voice', false], ['8', 'erased-voice', false], ['tmp_1', 'draft', true]])
    expect(onMarkerActivate.mock.calls[0][0].annotation.id).toBe('5')
  })
  it('works seek-only, without callbacks, and starts no mutation', () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); const onSeek = vi.fn()
    const { unmount } = strip([note()], { onSeek })
    const marker = screen.getByRole('button', { name: /text note/i })
    fireEvent.pointerDown(marker, { clientX: 100 }); fireEvent.pointerMove(window, { clientX: 300 }); fireEvent.pointerUp(window)
    fireEvent.click(marker)
    expect(onSeek).toHaveBeenCalledOnce(); expect(onSeek).toHaveBeenCalledWith(10)
    expect(fetch).not.toHaveBeenCalled(); unmount()
    strip([note()], { onSeek: undefined }); fireEvent.click(screen.getByRole('button'))
  })
})

describe('duration resolution and playhead', () => {
  it('prefers a finite native duration over the asset duration and rebinds listeners', () => {
    const a = fakeVideo(NaN)
    const ann = [note({ start_seconds: 10, duration_seconds: 10 })]
    const { rerender } = strip(ann, { videoEl: a })
    expect(screen.getByTestId('range-marker-5').style.left).toBe('10%')
    setDuration(a, 50); act(() => { a.dispatchEvent(new Event('loadedmetadata')) })
    expect(screen.getByTestId('range-marker-5').style.left).toBe('20%')
    setDuration(a, 200); act(() => { a.dispatchEvent(new Event('durationchange')) })
    expect(screen.getByTestId('range-marker-5').style.left).toBe('5%')
    const removed = vi.spyOn(a, 'removeEventListener')
    rerender(<TimelineStrip annotations={ann} videoEl={fakeVideo(40)} durationSeconds={100} onSeek={vi.fn()} />)
    expect(removed).toHaveBeenCalledWith('loadedmetadata', expect.any(Function))
    expect(screen.getByTestId('range-marker-5').style.left).toBe('25%')
    setDuration(a, 10); act(() => { a.dispatchEvent(new Event('durationchange')) })
    expect(screen.getByTestId('range-marker-5').style.left).toBe('25%')
  })
  it('keeps the playhead on the data axis and resets it on replacement or lost duration', () => {
    const a = fakeVideo(100)
    const { rerender } = strip([], { videoEl: a })
    const axis = screen.getByTestId('timeline-axis')
    expect(axis).toContainElement(screen.getByTestId('timeline-playhead'))
    expect(screen.getByTestId('timeline-lane-text')).not.toContainElement(axis)
    axis.style.setProperty('--playhead-percent', '60%')
    const b = fakeVideo(NaN)
    rerender(<TimelineStrip annotations={[]} videoEl={b} durationSeconds={100} onSeek={vi.fn()} />)
    expect(axis.style.getPropertyValue('--playhead-percent')).toBe('0%')
    setDuration(b, 80); act(() => { b.dispatchEvent(new Event('loadedmetadata')) })
    axis.style.setProperty('--playhead-percent', '30%')
    setDuration(b, NaN); act(() => { b.dispatchEvent(new Event('durationchange')) })
    expect(axis.style.getPropertyValue('--playhead-percent')).toBe('0%')
  })
})
