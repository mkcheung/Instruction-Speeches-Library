import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
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

    // BroadcastChannel delivery is asynchronous even within one JS realm.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(tabBReceived).toHaveBeenCalledWith(saved)
    // A tab never hears its own broadcast back.
    expect(tabAReceived).not.toHaveBeenCalled()
  })

  it('never cross-talks between different reviews', async () => {
    const receivedOnReview1 = vi.fn()
    const receivedOnReview2 = vi.fn()

    const { result: onReview1 } = renderHook(() => useAnnotationChannel(1, receivedOnReview1))
    renderHook(() => useAnnotationChannel(2, receivedOnReview2))

    onReview1.current(annotation())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(receivedOnReview2).not.toHaveBeenCalled()
  })

  it('does nothing when reviewId is null (no review to scope the channel to)', async () => {
    const received = vi.fn()
    const { result } = renderHook(() => useAnnotationChannel(null, received))
    // Posting with no channel open must not throw.
    expect(() => result.current(annotation())).not.toThrow()
  })
})
