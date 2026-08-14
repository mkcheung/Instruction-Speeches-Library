import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDeferredRemoval } from './useDeferredRemoval'

describe('useDeferredRemoval', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns the visible set as-is while nothing has left', () => {
    const { result } = renderHook(({ visible }) => useDeferredRemoval(visible), {
      initialProps: { visible: new Set(['a', 'b']) },
    })
    expect(result.current).toEqual(new Set())
  })

  it('keeps an id as a ghost after it leaves visibility, until ghostMs elapses', () => {
    const { result, rerender } = renderHook(({ visible }) => useDeferredRemoval(visible, 500), {
      initialProps: { visible: new Set(['a']) },
    })

    rerender({ visible: new Set() })
    expect(result.current.has('a')).toBe(true)

    act(() => vi.advanceTimersByTime(499))
    expect(result.current.has('a')).toBe(true)

    act(() => vi.advanceTimersByTime(2))
    expect(result.current.has('a')).toBe(false)
  })

  it('cancels a pending ghost removal if the id becomes visible again before the timer fires', () => {
    const { result, rerender } = renderHook(({ visible }) => useDeferredRemoval(visible, 500), {
      initialProps: { visible: new Set(['a']) },
    })

    rerender({ visible: new Set() }) // a becomes a ghost
    expect(result.current.has('a')).toBe(true)

    act(() => vi.advanceTimersByTime(200))
    rerender({ visible: new Set(['a']) }) // re-activated — no longer a ghost, it's visible again
    expect(result.current.has('a')).toBe(false)

    // The original timer must not fire and remove anything later — nothing
    // to remove since 'a' isn't tracked as a ghost anymore.
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.has('a')).toBe(false)
  })

  it('tracks multiple ids leaving at different times independently', () => {
    const { result, rerender } = renderHook(({ visible }) => useDeferredRemoval(visible, 300), {
      initialProps: { visible: new Set(['a', 'b']) },
    })

    rerender({ visible: new Set(['b']) }) // a leaves
    expect(result.current).toEqual(new Set(['a']))

    act(() => vi.advanceTimersByTime(200))
    rerender({ visible: new Set() }) // b leaves 200ms later
    expect(result.current).toEqual(new Set(['a', 'b']))

    act(() => vi.advanceTimersByTime(100)) // a's timer (300ms since it left) fires
    expect(result.current).toEqual(new Set(['b']))

    act(() => vi.advanceTimersByTime(200)) // b's timer (300ms since IT left) fires
    expect(result.current).toEqual(new Set())
  })
})
