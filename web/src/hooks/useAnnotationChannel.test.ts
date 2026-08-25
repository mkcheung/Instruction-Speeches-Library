import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAnnotationChannel } from '@/hooks/useAnnotationChannel'
import type { Annotation } from '@/features/annotation/types'

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: '1',
    start_seconds: 5,
    duration_seconds: 6,
    kind: 'observation',
    topic: null,
    body: 'hello',
    lock_version: 2,
    client_uuid: 'uuid-1',
    voice: null,
    ...overrides,
  }
}

/**
 * STEP-07-write-commentary.md: "a `BroadcastChannel` so a clean sibling
 * tab silently adopts the new version and only a dirty one escalates."
 * Confirmed to need no polyfill under this project's Vitest+jsdom setup —
 * jsdom forwards Node's native `BroadcastChannel` — so the handshake is
 * exercised directly with two real `BroadcastChannel`-backed hook
 * instances, standing in for two browser tabs.
 */
describe('useAnnotationChannel — two-tab handshake', () => {
  it('delivers a save from one "tab" to a sibling "tab" on the same review', async () => {
    const tabAReceived = vi.fn()
    const tabBReceived = vi.fn()

    const { result: tabA } = renderHook(() => useAnnotationChannel(42, tabAReceived))
    renderHook(() => useAnnotationChannel(42, tabBReceived))

    const saved = annotation({ body: 'saved from tab A' })
    tabA.current(saved)

    // BroadcastChannel delivery is asynchronous even within one JS realm,
    // and — per CP-07 — not guaranteed to land within a single tick under
    // load (this was a real flake on a loaded CI runner with a fixed
    // `setTimeout(resolve, 0)`). Poll instead of racing a fixed delay.
    await waitFor(() => expect(tabBReceived).toHaveBeenCalledWith(saved))
    // A tab never hears its own broadcast back.
    expect(tabAReceived).not.toHaveBeenCalled()
  })

  it('never cross-talks between different reviews', async () => {
    const receivedOnReview1Sibling = vi.fn()
    const receivedOnReview2 = vi.fn()

    const { result: onReview1 } = renderHook(() => useAnnotationChannel(1, () => {}))
    // A second listener on the SAME review, purely as a delivery-timing
    // control: once this has fired, the broadcast has definitely had time
    // to reach every listener on every channel, so the review-2 negative
    // assertion below isn't just "assert immediately and get lucky" (the
    // flake this test used to have with a fixed `setTimeout(resolve, 0)`).
    renderHook(() => useAnnotationChannel(1, receivedOnReview1Sibling))
    renderHook(() => useAnnotationChannel(2, receivedOnReview2))

    const sent = annotation()
    onReview1.current(sent)
    await waitFor(() => expect(receivedOnReview1Sibling).toHaveBeenCalledWith(sent))

    expect(receivedOnReview2).not.toHaveBeenCalled()
  })

  it('does nothing when reviewId is null (no review to scope the channel to)', async () => {
    const received = vi.fn()
    const { result } = renderHook(() => useAnnotationChannel(null, received))
    // Posting with no channel open must not throw.
    expect(() => result.current(annotation())).not.toThrow()
  })
})
