import { StrictMode, useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnerVideoTools, type OwnerVideoToolsProps, type OwnerTimelineStatus } from './OwnerVideoTools'
import type { Annotation } from '@/features/annotation/types'
import { FakeTextTrack } from '@/test/setup'

const text: Annotation = {
  id: 'text', timing_type: 'range', start_seconds: 10, duration_seconds: 6, kind: 'observation',
  topic: null, body: 'PRIVATE WRITTEN BODY', lock_version: 1, client_uuid: 'text', voice: null,
}
const voice: Annotation = { ...text, id: 'voice', client_uuid: 'voice', timing_type: 'point', start_seconds: 25,
  body: 'PRIVATE VOICE TRANSCRIPT', duration_seconds: 0,
  voice: { asset_id: 3, audio_status: 'processing', transcript_status: 'processing', failure_code: null },
}
const erased: Annotation = { ...text, id: 'erased', timing_type: 'point', start_seconds: 40, voice: null }

function video() {
  const el = document.createElement('video')
  Object.defineProperty(el, 'duration', { value: 100, configurable: true })
  el.currentTime = 30
  return el
}
function props(overrides: Partial<OwnerVideoToolsProps> = {}): OwnerVideoToolsProps {
  return {
    scopeKey: 'owner:1:2', playbackReady: true, videoEl: video(), navigationAnnotations: [text, voice],
    activeIds: new Set(['text']), durationSeconds: 120, reviewerLabel: 'Cora Coach', mode: 'all', status: 'ready',
    onSeek: vi.fn(), onOpenNotes: vi.fn(), frameSelector: <button>Use current frame</button>, ...overrides,
  }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('owner video tools', () => {
  it.each(['off', 'no-selection', 'empty', 'unavailable'] as const)('keeps scrub navigation independent of %s commentary', (status) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 44, right: 200, bottom: 44, x: 0, y: 0, toJSON: () => ({}),
    })
    const el = video()
    Object.defineProperty(el, 'readyState', { value: 1, configurable: true })
    const scrubSeek = vi.fn()
    const p = props({ videoEl: el, status, mode: status === 'off' ? 'off' : 'all',
      scrub: { bindingKey: 'owner:1:2:source1', enabled: true, active: true, onSeek: scrubSeek } })
    render(<OwnerVideoTools {...p} />)
    const slider = screen.getByRole('slider', { name: 'Video position' })
    expect(slider).toHaveAttribute('aria-disabled', 'false')
    expect(screen.queryByTestId('range-marker-text')).not.toBeInTheDocument()
    fireEvent.keyDown(slider, { key: 'End' })
    expect(scrubSeek).toHaveBeenCalledExactlyOnceWith(100)
    expect(p.onSeek).not.toHaveBeenCalled()
  })

  it('disables the kept-mounted scrubber on Frame selector and preserves that tab through source readiness changes', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 44, right: 200, bottom: 44, x: 0, y: 0, toJSON: () => ({}),
    })
    const el = video()
    Object.defineProperty(el, 'readyState', { value: 1, configurable: true })
    const scrubSeek = vi.fn()
    const p = props({ videoEl: el, scrub: { bindingKey: 'source1', enabled: true, active: true, onSeek: scrubSeek } })
    const view = render(<OwnerVideoTools {...p} />)
    const slider = screen.getByRole('slider')
    fireEvent.click(screen.getByRole('tab', { name: 'Frame selector' }))
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(slider, { key: 'End' })
    expect(scrubSeek).not.toHaveBeenCalled()
    view.rerender(<OwnerVideoTools {...p} playbackReady={false} scrub={{ ...p.scrub!, bindingKey: 'source2' }} />)
    view.rerender(<OwnerVideoTools {...p} scrub={{ ...p.scrub!, bindingKey: 'source2' }} />)
    expect(screen.getByRole('tab', { name: 'Frame selector' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
    expect(screen.getByRole('slider')).toBe(slider)
    expect(slider).toHaveAttribute('aria-disabled', 'false')
  })

  it('uses the actual timeline with native duration, exact ranges, voice points and body-free labels', () => {
    const p = props({ navigationAnnotations: [text, voice, erased] })
    render(<OwnerVideoTools {...p} />)
    expect(screen.getByRole('tablist', { name: 'Video tools' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Commentary timeline' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Cora Coach · Text + audio')).toBeVisible()
    expect(screen.getByTestId('range-marker-text')).toHaveStyle({ left: '10%', width: '6%' })
    expect(screen.getByTestId('range-marker-text')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('voice-marker-voice')).toHaveAccessibleName('Voice note at 25 seconds')
    expect(screen.getByTestId('voice-marker-erased')).toHaveAccessibleName('Voice note at 40 seconds, audio unavailable')
    expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument()
    expect(screen.getByTestId('timeline-ticks')).toHaveTextContent('0:000:501:40')
    expect(screen.queryByRole('button', { name: 'Use current frame' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use current frame', hidden: true })).toBeInTheDocument()
  })

  it('seeks exactly once and only delegates navigation; tabs and Notes leave media and metadata alone', async () => {
    const user = userEvent.setup()
    const el = video()
    const track = new FakeTextTrack()
    const addTrack = vi.spyOn(el, 'addTextTrack').mockReturnValue(track as unknown as TextTrack)
    const play = vi.spyOn(el, 'play').mockResolvedValue()
    const pause = vi.spyOn(el, 'pause').mockImplementation(() => {})
    const p = props({ videoEl: el })
    render(<OwnerVideoTools {...p} />)
    await user.click(screen.getByRole('button', { name: 'Text note from 10 seconds to 16 seconds' }))
    expect(p.onSeek).toHaveBeenCalledExactlyOnceWith(10)
    await user.click(screen.getByRole('tab', { name: 'Frame selector' }))
    await user.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
    await user.click(screen.getByRole('button', { name: 'Open Notes' }))
    expect(p.onOpenNotes).toHaveBeenCalledOnce()
    expect(p.onSeek).toHaveBeenCalledTimes(1)
    expect(el.currentTime).toBe(30)
    expect(play).not.toHaveBeenCalled()
    expect(pause).not.toHaveBeenCalled()
    expect(addTrack).not.toHaveBeenCalled()
    expect(track.addCue).not.toHaveBeenCalled()
    expect(track.removeCue).not.toHaveBeenCalled()
  })

  it.each([
    ['all', [text, voice, erased], 3, 'Text + audio'],
    ['written', [text, erased], 2, 'Written notes only'],
    ['voice', [voice], 1, 'Audio only'],
    ['off', [text, voice], 0, 'Off'],
  ] as const)('uses only the supplied %s projection and preserves both lane labels', (mode, rows, count, label) => {
    render(<OwnerVideoTools {...props({ mode, navigationAnnotations: rows })} />)
    const timeline = screen.getByRole('group', { name: 'Annotation timeline' })
    expect(within(timeline).queryAllByRole('button')).toHaveLength(count)
    expect(within(timeline).getByText('Text')).toBeVisible()
    expect(within(timeline).getByText('Voice')).toBeVisible()
    expect(screen.getByText(mode === 'off' ? label : `Cora Coach · ${label}`)).toBeVisible()
    expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument()
    if (mode === 'off') expect(screen.getByRole('status')).toHaveTextContent('Commentary is off. Open Notes to enable it.')
  })

  it.each([
    ['loading', 'Loading commentary…'],
    ['unavailable', 'Commentary is unavailable. Open Notes for details.'],
    ['no-selection', 'Choose a reviewer in Notes to see their commentary.'],
    ['empty', 'This reviewer has no published commentary yet.'],
    ['mode-empty', 'No commentary matches this playback mode. Open Notes to change it.'],
    ['off', 'Commentary is off. Open Notes to enable it.'],
  ] satisfies [OwnerTimelineStatus, string][])('distinguishes %s from successful populated feedback', (status, message) => {
    render(<OwnerVideoTools {...props({ status })} />)
    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(within(screen.getByRole('group', { name: 'Annotation timeline' })).queryAllByRole('button')).toHaveLength(0)
    if (['loading', 'unavailable', 'no-selection', 'off'].includes(status)) expect(screen.queryByText(/Cora Coach/)).not.toBeInTheDocument()
  })

  it('shows a nonterminal refresh error alongside the already authorized projection', () => {
    render(<OwnerVideoTools {...props({ refreshError: true })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Commentary could not refresh.')
    expect(screen.getByRole('button', { name: 'Voice note at 25 seconds' })).toBeVisible()
  })

  it('retains the exact pending frame child through tabs, mode/reviewer changes and readiness; only scope resets it', async () => {
    const user = userEvent.setup()
    let settle!: () => void
    const pending = new Promise<void>((resolve) => { settle = resolve })
    const request = vi.fn(() => pending)
    function Frame({ disabled }: { disabled: boolean }) {
      const [state, setState] = useState('idle')
      return <button disabled={disabled || state === 'pending'} onClick={() => {
        setState('pending')
        void request().then(() => setState('saved'))
      }}>Frame {state}</button>
    }
    const p = props({ frameSelector: <Frame disabled={false} /> })
    const tree = (next: OwnerVideoToolsProps) => <StrictMode><OwnerVideoTools {...next} /></StrictMode>
    const view = render(tree(p))
    await user.click(screen.getByRole('tab', { name: 'Frame selector' }))
    const frame = screen.getByRole('button', { name: 'Frame idle' })
    await user.click(frame)
    await user.click(screen.getByRole('tab', { name: 'Commentary timeline' }))
    view.rerender(tree({ ...p, playbackReady: false, reviewerLabel: 'Another reviewer', mode: 'voice', frameSelector: <Frame disabled /> }))
    expect(screen.queryByTestId('range-marker-text')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Preparing video.')
    expect(screen.getByRole('button', { name: 'Frame pending', hidden: true })).toBe(frame)
    await user.click(screen.getByRole('tab', { name: 'Frame selector' }))
    expect(screen.getByRole('button', { name: 'Frame pending' })).toBe(frame)
    expect(frame).toBeDisabled()
    await act(async () => { settle(); await pending })
    view.rerender(tree({ ...p, reviewerLabel: 'Another reviewer', mode: 'written' }))
    expect(screen.getByRole('tab', { name: 'Frame selector' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Frame saved' })).toBe(frame)
    expect(request).toHaveBeenCalledOnce()
    view.rerender(tree({ ...p, scopeKey: 'owner:1:3' }))
    expect(screen.getByRole('tab', { name: 'Commentary timeline' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Frame idle', hidden: true })).not.toBe(frame)
  })

  it('suspends the actual playhead binding while preparing and cleans up its animation frame', () => {
    let tick: FrameRequestCallback | undefined
    const request = vi.fn((callback: FrameRequestCallback) => { tick = callback; return 42 })
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const p = props()
    const view = render(<OwnerVideoTools {...p} />)
    act(() => tick?.(0))
    expect(screen.getByTestId('timeline-axis').style.getPropertyValue('--playhead-percent')).toBe('30%')
    view.rerender(<OwnerVideoTools {...p} playbackReady={false} />)
    expect(cancel).toHaveBeenCalledWith(42)
    expect(screen.getByTestId('timeline-axis').style.getPropertyValue('--playhead-percent')).toBe('0%')
    expect(screen.queryByTestId('voice-marker-voice')).not.toBeInTheDocument()
  })

  it('supports arrow/Home/End/Space keyboard navigation and keeps inactive controls hidden', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<OwnerVideoTools {...p} />)
    const timelineTab = screen.getByRole('tab', { name: 'Commentary timeline' })
    const frameTab = screen.getByRole('tab', { name: 'Frame selector' })
    act(() => timelineTab.focus())
    await user.keyboard('{ArrowRight}')
    expect(frameTab).toHaveFocus()
    await user.keyboard(' ')
    expect(frameTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Open Notes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use current frame' })).toBeVisible()
    await user.keyboard('{Home}')
    expect(timelineTab).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(timelineTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(frameTab).toHaveFocus()
    await user.keyboard(' ')
    expect(frameTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(timelineTab)
    const marker = screen.getByRole('button', { name: 'Voice note at 25 seconds' })
    act(() => marker.focus())
    await user.keyboard('{Enter}')
    expect(marker).toHaveFocus()
    expect(p.onSeek).toHaveBeenCalledExactlyOnceWith(25)
  })
})
