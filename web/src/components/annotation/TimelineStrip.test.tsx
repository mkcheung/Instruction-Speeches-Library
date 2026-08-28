import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { TimelineStrip } from '@/components/annotation/TimelineStrip'
import { createTestStore, clearCookies } from '@/test/renderWithProviders'
import type { Annotation } from '@/features/annotation/types'

function urlOf(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString()
}

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: '5',
    start_seconds: 10,
    duration_seconds: 6,
    kind: 'observation',
    topic: null,
    body: 'a marker to drag',
    lock_version: 1,
    client_uuid: 'client-uuid-5',
    voice: null,
    ...overrides,
  }
}

function renderStrip(onLiveRetime: (live: Annotation) => void) {
  return render(
    <Provider store={createTestStore()}>
      <TimelineStrip
        annotations={[annotation()]}
        speechId={1}
        reviewId={9}
        videoEl={null}
        durationSeconds={100}
        onSeek={() => {}}
        onLiveRetime={onLiveRetime}
      />
    </Provider>,
  )
}

/** `startDrag` reads `getBoundingClientRect().width` to convert pixel
 * deltas to seconds — jsdom returns all-zero rects by default, which would
 * make every delta divide by zero. */
function stubContainerRect() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1000,
    height: 24,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 24,
    x: 0,
    y: 0,
    toJSON: () => {},
  })
}

describe('TimelineStrip — drag interruption', () => {
  it('renders a voice note as a point glyph without duration resize handles', () => {
    render(
      <Provider store={createTestStore()}>
        <TimelineStrip
          annotations={[
            annotation({
              id: 'voice',
              voice: { asset_id: 1, audio_status: 'ready', transcript_status: 'ready', failure_code: null },
            }),
          ]}
          speechId={1}
          reviewId={9}
          videoEl={null}
          durationSeconds={100}
          onSeek={() => {}}
          onLiveRetime={() => {}}
        />
      </Provider>,
    )
    expect(screen.getByRole('button', { name: /voice note at/i })).toBeVisible()
    expect(screen.queryByTestId('marker-voice-duration-handle')).not.toBeInTheDocument()
  })
  beforeEach(() => clearCookies())
  afterEach(() => vi.unstubAllGlobals())

  it('cleans up on pointercancel: no PATCH fires, the live preview is restored, and later pointer moves are ignored', async () => {
    stubContainerRect()

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (urlOf(input).includes('/sanctum/csrf-cookie')) return new Response(null, { status: 204 })
      throw new Error(`unexpected fetch (a cancelled drag must never PATCH): ${urlOf(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const onLiveRetime = vi.fn()
    renderStrip(onLiveRetime)

    const handle = screen.getByTestId('marker-5-start-handle')
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100 }))

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 }))
    expect(onLiveRetime).toHaveBeenCalled()
    const duringDrag = onLiveRetime.mock.calls.at(-1)?.[0] as Annotation
    expect(duringDrag.start_seconds).not.toBe(10)

    window.dispatchEvent(new PointerEvent('pointercancel'))

    // Cancel restores the pre-drag position rather than leaving the
    // preview stuck on the interrupted drag's last position.
    const afterCancel = onLiveRetime.mock.calls.at(-1)?.[0] as Annotation
    expect(afterCancel.start_seconds).toBe(10)
    expect(afterCancel.duration_seconds).toBe(6)

    const callsAfterCancel = onLiveRetime.mock.calls.length

    // Without the fix, these listeners stay attached to `window` forever —
    // any later, unrelated pointer movement anywhere on the page would
    // still invoke this drag's stale closure.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500 }))
    window.dispatchEvent(new PointerEvent('pointerup'))
    expect(onLiveRetime).toHaveBeenCalledTimes(callsAfterCancel)

    // And no PATCH was ever sent for the interrupted drag.
    const patchCalls = fetchMock.mock.calls.filter(([input]) => urlOf(input).includes('/annotations/5'))
    expect(patchCalls).toHaveLength(0)
  })

  describe('strip height', () => {
    // Regression: `Math.max(1, Math.min(MAX_ROWS, ...rows))` spread the row
    // indices into Math.MIN, so it picked the FEWEST rows in use. Two
    // staggered markers reserved 1.5rem while the row-1 marker sits at
    // `top: 1.5rem` — outside its own bordered box, spilling onto the
    // composer (no `overflow: hidden`). The empty case inverted the other
    // way: `Math.min(MAX_ROWS)` over no rows returned 2, double height.
    function renderWith(annotations: Annotation[]) {
      const { container } = render(
        <Provider store={createTestStore()}>
          <TimelineStrip
            annotations={annotations}
            speechId={1}
            reviewId={9}
            videoEl={null}
            durationSeconds={100}
            onSeek={() => {}}
            onLiveRetime={() => {}}
          />
        </Provider>,
      )
      return container.querySelector('.annotation-timeline') as HTMLElement
    }

    it('reserves a row for every occupied row when markers overlap', () => {
      const strip = renderWith([
        annotation({ id: '1', client_uuid: 'u1', start_seconds: 10, duration_seconds: 6 }),
        annotation({ id: '2', client_uuid: 'u2', start_seconds: 12, duration_seconds: 6 }),
      ])
      expect(strip.style.height).toBe('3rem')
    })

    it('reserves exactly one row when there are no annotations', () => {
      expect(renderWith([]).style.height).toBe('1.5rem')
    })
  })
})
