import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDismissedUntilRefetch } from './useDismissedUntilRefetch'

describe('query snapshot dismissals', () => {
  it('does not hide matching IDs from another cached query with the same timestamp', () => {
    const { result, rerender } = renderHook(({ timestamp, key }) => useDismissedUntilRefetch<number>(timestamp, key), {
      initialProps: { timestamp: 10, key: 'incoming' },
    })
    act(() => result.current.dismiss(42))
    expect(result.current.isDismissed(42)).toBe(true)
    expect(result.current.isDismissed(43)).toBe(false)

    rerender({ timestamp: 10, key: 'search' })
    expect(result.current.isDismissed(42)).toBe(false)
    act(() => result.current.dismiss(43))
    expect(result.current.isDismissed(42)).toBe(false)
    expect(result.current.isDismissed(43)).toBe(true)

    rerender({ timestamp: 11, key: 'search' })
    expect(result.current.isDismissed(43)).toBe(false)
  })

  it('explicitly resets applied searches even if the same cached snapshot returns', () => {
    const { result, rerender } = renderHook(({ key }) => useDismissedUntilRefetch<string>(10, key), {
      initialProps: { key: 'Alice' },
    })
    act(() => result.current.dismiss('person-a'))
    rerender({ key: 'Bob' })
    act(() => result.current.reset())
    rerender({ key: 'Alice' })
    expect(result.current.isDismissed('person-a')).toBe(false)
  })
})
