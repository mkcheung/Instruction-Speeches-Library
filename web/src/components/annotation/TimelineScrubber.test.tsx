import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, Profiler } from 'react'
import { TimelineStrip } from './TimelineStrip'
import type { TimelineScrubCapability } from './TimelineScrubber'

class TestPointerEvent extends MouseEvent {
  pointerId: number
  isPrimary: boolean
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.isPrimary = init.isPrimary ?? true
    this.pointerType = init.pointerType ?? 'mouse'
  }
}
function media(duration = 100, currentTime = 20) {
  const video = document.createElement('video')
  Object.defineProperties(video, {
    duration: { value: duration, writable: true, configurable: true },
    readyState: { value: 1, writable: true, configurable: true },
    currentTime: { value: currentTime, writable: true, configurable: true },
    error: { value: null, writable: true, configurable: true },
  })
  return video
}
function assign(video: HTMLVideoElement, values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) Object.defineProperty(video, key, { value, writable: true, configurable: true })
}
let geometry: DOMRect
beforeEach(() => {
  geometry = { left: 156, top: 20, width: 400, height: 44, right: 556, bottom: 64, x: 156, y: 20, toJSON() {} }
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => geometry)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function setup(overrides: Partial<TimelineScrubCapability> = {}, video = media(), strict = false) {
  const seek = vi.fn()
  const marker = vi.fn()
  let capability = { bindingKey: 'u1/s1/a1/r1/g1', enabled: true, active: true, onSeek: seek, ...overrides }
  const view = (el: HTMLVideoElement | null) => <TimelineStrip annotations={[]} videoEl={el} durationSeconds={999}
    onSeek={marker} onMarkerActivate={marker} scrub={capability} />
  const result = render(strict ? <StrictMode>{view(video)}</StrictMode> : view(video))
  const slider = screen.getByRole('slider', { name: 'Video position' })
  const capture = new Set<number>()
  Object.assign(slider, {
    setPointerCapture: vi.fn((id: number) => capture.add(id)),
    hasPointerCapture: vi.fn((id: number) => capture.has(id)),
    releasePointerCapture: vi.fn((id: number) => {
      capture.delete(id)
      fireEvent.lostPointerCapture(slider, { pointerId: id })
    }),
  })
  const update = (changes: Partial<TimelineScrubCapability> = {}, el: HTMLVideoElement | null = video) => {
    capability = { ...capability, ...changes }
    result.rerender(strict ? <StrictMode>{view(el)}</StrictMode> : view(el))
  }
  return { ...result, slider, video, seek, marker, update, capture,
    axis: screen.getByTestId('timeline-axis'), grip: slider.querySelector('.awt-scrubber-grip')!,
    time: slider.querySelector('.awt-scrubber-time')! }
}
const pointer = (target: Element, event: 'down' | 'move' | 'up', clientX: number, extras: PointerEventInit = {}) => {
  const init = { pointerId: 1, isPrimary: true, button: 0, clientX, ...extras }
  if (event === 'down') fireEvent.pointerDown(target, init)
  else if (event === 'move') fireEvent.pointerMove(target, init)
  else fireEvent.pointerUp(target, init)
}

describe('release-only real timeline navigation', () => {
  it.each(['mouse', 'pen', 'touch'])('previews %s on the gutter-excluding translated axis and commits the final position once', (pointerType) => {
    const { slider, axis, video, seek, marker } = setup()
    expect(axis).toContainElement(slider)
    pointer(slider, 'down', 256, { pointerType })
    pointer(slider, 'move', 356, { pointerType })
    expect(video.currentTime).toBe(20)
    expect(seek).not.toHaveBeenCalled()
    expect(axis.style.getPropertyValue('--scrub-preview-percent')).toBe('50%')
    expect(slider).toHaveAttribute('aria-valuenow', '50')
    expect(slider).toHaveTextContent('Release to seek')
    pointer(slider, 'up', 456, { pointerType })
    pointer(slider, 'up', 500, { pointerType })
    fireEvent.click(slider)
    expect(seek).toHaveBeenCalledExactlyOnceWith(75)
    expect(marker).not.toHaveBeenCalled()
    expect(axis.style.getPropertyValue('--scrub-preview-percent')).toBe('')
  })
  it('keeps the actual writer independent and lets natural playback advance during a preview', () => {
    const { slider, axis, video, seek } = setup()
    axis.style.setProperty('--playhead-percent', '20%')
    const seeking = vi.fn(); video.addEventListener('seeking', seeking)
    pointer(slider, 'down', 356)
    assign(video, { currentTime: 23 })
    fireEvent.timeUpdate(video)
    axis.style.setProperty('--playhead-percent', '23%')
    expect(slider).toHaveAttribute('aria-valuenow', '50')
    expect(axis.style.getPropertyValue('--playhead-percent')).toBe('23%')
    expect(seeking).not.toHaveBeenCalled()
    expect(seek).not.toHaveBeenCalled()
    fireEvent.pointerCancel(slider, { pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '23')
    expect(axis.style.getPropertyValue('--scrub-preview-percent')).toBe('')
  })
  it('accounts for an off-center grip grab and accepts a movement present only on release', () => {
    const { slider, grip, seek } = setup()
    pointer(grip, 'down', 240) // actual position236, grab4px to the right.
    expect(slider).toHaveAttribute('aria-valuenow', '20')
    pointer(slider, 'up', 280)
    expect(seek).toHaveBeenCalledExactlyOnceWith(30)
  })
  it('never seeks a stationary grip hold while footage advances, including subthreshold jitter', () => {
    const { slider, grip, video, seek } = setup()
    pointer(grip, 'down', 236)
    assign(video, { currentTime: 35 }); fireEvent.timeUpdate(video)
    pointer(slider, 'move', 238)
    pointer(slider, 'up', 238)
    expect(seek).not.toHaveBeenCalled()
    expect(slider).toHaveAttribute('aria-valuenow', '35')
  })
  it('remembers an intentional away-and-back drag while the actual video advances', () => {
    const { slider, grip, video, seek } = setup()
    pointer(grip, 'down', 236); pointer(slider, 'move', 276)
    assign(video, { currentTime: 22 })
    pointer(slider, 'up', 236)
    expect(seek).toHaveBeenCalledExactlyOnceWith(20)
  })
  it.each([[100, 0], [800, 100]])('clamps a captured release outside the row at %i to %i', (x, expected) => {
    const { slider, seek } = setup()
    pointer(slider, 'down', 356); pointer(slider, 'up', x)
    expect(seek).toHaveBeenCalledExactlyOnceWith(expected)
  })
  it('accepts an unmoved rail click and skips a genuinely unchanged position', () => {
    const { slider, seek } = setup()
    pointer(slider, 'down', 236); pointer(slider, 'up', 236)
    expect(seek).not.toHaveBeenCalled()
    pointer(slider, 'down', 356); pointer(slider, 'up', 356)
    expect(seek).toHaveBeenCalledExactlyOnceWith(50)
  })
  it('ignores extra pointers, right-click and non-primary pointers without ending the primary session', () => {
    const { slider, seek } = setup()
    pointer(slider, 'down', 456, { button: 2 }); pointer(slider, 'up', 456, { button: 2 })
    pointer(slider, 'down', 456, { isPrimary: false }); pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
    pointer(slider, 'down', 356)
    pointer(slider, 'down', 456, { pointerId: 2, isPrimary: false })
    pointer(slider, 'move', 456, { pointerId: 2 }); pointer(slider, 'up', 456, { pointerId: 2 })
    fireEvent.pointerCancel(slider, { pointerId: 2 })
    fireEvent.lostPointerCapture(slider, { pointerId: 2 })
    pointer(slider, 'up', 456, { button: 2 })
    pointer(slider, 'up', 376)
    expect(seek).toHaveBeenCalledExactlyOnceWith(55.00000000000001)
  })
  it('abandons a failed pointer capture safely', () => {
    const { slider, seek, axis } = setup()
    slider.setPointerCapture = () => { throw new Error('capture unavailable') }
    pointer(slider, 'down', 356); pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
    expect(axis.style.getPropertyValue('--scrub-preview-percent')).toBe('')
  })
  it('rechecks native authority after releasing capture before dispatching a commit', () => {
    const { slider, video, seek } = setup()
    pointer(slider, 'down', 356)
    slider.releasePointerCapture = () => { assign(video, { readyState: 0 }) }
    pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
  })
})

describe('cancellation and source epochs', () => {
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'resize', 'visibility', 'escape', 'tab'])('cancels %s without a late release seek', (reason) => {
    const { slider, axis, seek, capture } = setup()
    pointer(slider, 'down', 356)
    if (reason === 'pointercancel') fireEvent.pointerCancel(slider, { pointerId: 1 })
    if (reason === 'lostpointercapture') fireEvent.lostPointerCapture(slider, { pointerId: 1 })
    if (reason === 'blur') fireEvent(window, new Event('blur'))
    if (reason === 'resize') fireEvent(window, new Event('resize'))
    if (reason === 'visibility') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      fireEvent(document, new Event('visibilitychange'))
    }
    if (reason === 'escape') fireEvent.keyDown(slider, { key: 'Escape' })
    if (reason === 'tab') expect(fireEvent.keyDown(slider, { key: 'Tab' })).toBe(true)
    pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
    expect(capture.size).toBe(0)
    expect(axis.style.getPropertyValue('--scrub-preview-percent')).toBe('')
  })
  it.each(['hidden', 'inert', 'display', 'visibility'])('rejects capture through an ancestor made %s without a React render', (reason) => {
    const { slider, seek, axis } = setup()
    pointer(slider, 'down', 356)
    const ancestor = screen.getByTestId('timeline-strip')
    if (reason === 'hidden') ancestor.hidden = true
    if (reason === 'inert') ancestor.setAttribute('inert', '')
    if (reason === 'display') ancestor.style.display = 'none'
    if (reason === 'visibility') ancestor.style.visibility = 'hidden'
    pointer(slider, 'up', 456) // synchronous: commit cannot depend on the observer having run.
    expect(seek).not.toHaveBeenCalled()
    expect(axis.style.getPropertyValue('--scrub-preview-percent')).toBe('')
  })
  it.each(['enabled', 'active', 'binding', 'video', 'missing'])('cancels a committed %s gate change immediately', (gate) => {
    const { slider, seek, update } = setup()
    pointer(slider, 'down', 356)
    if (gate === 'enabled') update({ enabled: false })
    if (gate === 'active') update({ active: false })
    if (gate === 'binding') update({ bindingKey: 'u2/s1/a1/r1/g1' })
    if (gate === 'video') update({}, media())
    if (gate === 'missing') update({}, null)
    pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
  })
  it('dispatches only to the latest committed callback', () => {
    const { slider, seek, update } = setup()
    pointer(slider, 'down', 356)
    const replacement = vi.fn(); update({ onSeek: replacement })
    pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledExactlyOnceWith(75)
  })
  it.each(['loadstart', 'emptied', 'error'])('requires fresh metadata after %s even with retained duration/readiness', (event) => {
    const { slider, video, seek } = setup()
    pointer(slider, 'down', 356)
    fireEvent(video, new Event(event))
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    fireEvent.durationChange(video)
    pointer(slider, 'up', 456)
    pointer(slider, 'down', 356); pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
    fireEvent.loadedMetadata(video)
    expect(slider).toHaveAttribute('aria-disabled', 'false')
    pointer(slider, 'down', 356); pointer(slider, 'up', 456)
    expect(seek).toHaveBeenCalledExactlyOnceWith(75)
  })
  it.each(['duration', 'geometry', 'source', 'readyState', 'error'])('revalidates current native %s at release even without an event', (change) => {
    const { slider, video, seek } = setup()
    pointer(slider, 'down', 356)
    if (change === 'duration') assign(video, { duration: 200 })
    if (change === 'geometry') geometry = { ...geometry, width: 500 }
    if (change === 'source') video.setAttribute('src', 'new-source.mp4')
    if (change === 'readyState') assign(video, { readyState: 0 })
    if (change === 'error') assign(video, { error: { code: 2 } })
    pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
  })
  it('cleans exact native element listeners, preview and pointer capture on StrictMode unmount', () => {
    const video = media(); const remove = vi.spyOn(video, 'removeEventListener')
    const { slider, axis, unmount, capture } = setup({}, video, true)
    pointer(slider, 'down', 356)
    unmount()
    expect(capture.size).toBe(0)
    expect(axis.style.getPropertyValue('--scrub-preview-percent')).toBe('')
    for (const event of ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'durationchange', 'loadstart', 'emptied', 'error']) {
      expect(remove).toHaveBeenCalledWith(event, expect.any(Function))
    }
  })
  it('cancels a native duration change instead of rescaling the release', () => {
    const { slider, video, seek } = setup()
    pointer(slider, 'down', 356)
    assign(video, { duration: 200 }); fireEvent.durationChange(video)
    pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
    expect(slider).toHaveAttribute('aria-valuemax', '200')
  })
  it('ignores retired native listeners and cannot enable an errored source from metadata', () => {
    const { slider, video, update, seek } = setup()
    const replacement = media(60, 10)
    update({}, replacement)
    fireEvent(video, new Event('error'))
    fireEvent.loadedMetadata(video)
    expect(slider).toHaveAttribute('aria-valuemax', '60')
    expect(slider).toHaveAttribute('aria-disabled', 'false')
    assign(replacement, { error: { code: 2 } })
    fireEvent(replacement, new Event('error'))
    fireEvent.loadedMetadata(replacement)
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(slider, { key: 'End' })
    expect(seek).not.toHaveBeenCalled()
  })
  it('cancels and removes focusability when only an ancestor becomes inert', async () => {
    const { slider, axis, seek } = setup()
    pointer(slider, 'down', 356)
    await act(async () => { screen.getByTestId('timeline-strip').setAttribute('inert', '') })
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(slider).toHaveAttribute('tabindex', '-1')
    expect(axis.style.getPropertyValue('--scrub-preview-percent')).toBe('')
    pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
  })
  it('ignores position-only axis mutations without doing layout work', async () => {
    const { axis } = setup()
    await act(async () => {}) // Flush setup observers before measuring an actual-writer update.
    const measured = vi.mocked(Element.prototype.getBoundingClientRect)
    measured.mockClear()
    await act(async () => { axis.style.setProperty('--playhead-percent', '35%') })
    expect(measured).not.toHaveBeenCalled()
  })
})

describe('local keyboard and DOM accessibility synchronization', () => {
  it.each([[NaN, 1], [Infinity, 1], [0, 1], [100, 0]])('requires native duration %s and metadata readiness %i despite asset fallback', (duration, readyState) => {
    const video = media(duration); assign(video, { readyState })
    const { slider, seek } = setup({}, video)
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(slider).toHaveAttribute('tabindex', '-1')
    pointer(slider, 'down', 356); pointer(slider, 'up', 456)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(seek).not.toHaveBeenCalled()
  })
  it('rejects a zero-width control and supports a short finite native duration', () => {
    geometry = { ...geometry, width: 0 }
    const { slider, seek, update } = setup({}, media(0.5, 0.1))
    pointer(slider, 'down', 356); pointer(slider, 'up', 456)
    expect(seek).not.toHaveBeenCalled()
    geometry = { ...geometry, width: 400 }; update()
    fireEvent.keyDown(slider, { key: 'End' })
    expect(seek).toHaveBeenCalledExactlyOnceWith(0.5)
  })
  it.each([['ArrowLeft', 19], ['ArrowDown', 19], ['ArrowRight', 21], ['ArrowUp', 21], ['PageDown', 10], ['PageUp', 30], ['Home', 0], ['End', 100]])('seeks %s once to %i using native time', (key, value) => {
    const { slider, seek } = setup()
    expect(fireEvent.keyDown(slider, { key })).toBe(false)
    expect(seek).toHaveBeenCalledExactlyOnceWith(value)
  })
  it('resolves keyboard from the candidate and retires its pointer session first', () => {
    const { slider, seek } = setup()
    pointer(slider, 'down', 356)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    pointer(slider, 'up', 456)
    expect(seek).toHaveBeenCalledExactlyOnceWith(51)
  })
  it('discards a stale pointer candidate before a new keyboard seek', () => {
    const { slider, video, seek } = setup()
    pointer(slider, 'down', 356)
    assign(video, { duration: 200 })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    pointer(slider, 'up', 456)
    expect(seek).toHaveBeenCalledExactlyOnceWith(21)
  })
  it('owns app shortcuts and Escape, while preserving browser modifier and Tab defaults', () => {
    const { slider, seek } = setup()
    const global = vi.fn(); window.addEventListener('keydown', global)
    for (const key of [' ', 'Enter', 'c', 'C', 'j', 'l', '[', ']', ',', '.']) expect(fireEvent.keyDown(slider, { key })).toBe(false)
    expect(fireEvent.keyDown(slider, { key: 'l', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(slider, { key: 'ArrowLeft', metaKey: true })).toBe(true)
    pointer(slider, 'down', 356)
    expect(fireEvent.keyDown(slider, { key: 'Escape' })).toBe(false)
    expect(fireEvent.keyDown(slider, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(global).not.toHaveBeenCalled(); expect(seek).not.toHaveBeenCalled()
    window.removeEventListener('keydown', global)
  })
  it('updates spoken time/readout without React commits or an extra rAF, and survives unrelated commits', () => {
    const video = media(120, 20); const commits = vi.fn()
    const request = vi.spyOn(window, 'requestAnimationFrame')
    const cap = { bindingKey: 'binding', enabled: true, active: true, onSeek: vi.fn() }
    const view = () => <Profiler id="timeline" onRender={commits}><TimelineStrip annotations={[]} videoEl={video} durationSeconds={999} scrub={cap} /></Profiler>
    const { rerender } = render(view())
    const initialCommits = commits.mock.calls.length
    const initialFrames = request.mock.calls.length
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemax', '120')
    act(() => { assign(video, { currentTime: 61 }); video.dispatchEvent(new Event('timeupdate')) })
    expect(slider).toHaveAttribute('aria-valuenow', '61')
    expect(slider).toHaveAttribute('aria-valuetext', '1 minute 1 second of 2 minutes 0 seconds')
    expect(slider.querySelector('.awt-scrubber-time')).toHaveTextContent('1:01 / 2:00')
    expect(commits).toHaveBeenCalledTimes(initialCommits)
    expect(request).toHaveBeenCalledTimes(initialFrames)
    rerender(view())
    expect(slider).toHaveAttribute('aria-valuenow', '61')
    expect(slider.querySelector('.awt-scrubber-time')).toHaveTextContent('1:01 / 2:00')
  })
})
