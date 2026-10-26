import { act, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionRefresh } from './connectionSession'

describe('scoped connection refresh', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('uses the latest callback and removes timers and listeners when disabled', () => {
    const first = vi.fn(), latest = vi.fn()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const timers = vi.spyOn(window, 'setInterval')
    const { rerender, unmount } = renderHook(({ refetch, enabled }) => useConnectionRefresh(refetch, enabled, 60_000), {
      initialProps: { refetch: first, enabled: false },
    })
    fireEvent(window, new Event('focus'))
    act(() => vi.advanceTimersByTime(60_000))
    expect(first).not.toHaveBeenCalled()

    rerender({ refetch: first, enabled: true })
    fireEvent(window, new Event('focus'))
    expect(first).toHaveBeenCalledTimes(1)
    rerender({ refetch: latest, enabled: true })
    expect(timers).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(60_000))
    expect(latest).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('hidden')
    fireEvent(window, new Event('focus'))
    act(() => vi.advanceTimersByTime(60_000))
    expect(latest).toHaveBeenCalledTimes(1)
    visibility.mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    expect(latest).toHaveBeenCalledTimes(2)

    rerender({ refetch: latest, enabled: false })
    expect(vi.getTimerCount()).toBe(0)
    fireEvent(window, new Event('focus'))
    act(() => vi.advanceTimersByTime(60_000))
    expect(latest).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('does not poll by default and cleans an enabled timer on unmount', () => {
    const refetch = vi.fn()
    const { rerender, unmount } = renderHook(({ interval }) => useConnectionRefresh(refetch, true, interval), {
      initialProps: { interval: undefined as number | undefined },
    })
    act(() => vi.advanceTimersByTime(120_000))
    expect(refetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    rerender({ interval: 60_000 })
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    fireEvent(window, new Event('focus'))
    expect(refetch).not.toHaveBeenCalled()
  })
})
