import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useReviewerDirectory } from './useReviewerDirectory'

const query = vi.hoisted(() => vi.fn((args: { search?: string; credential?: string; page?: number }) => args))
vi.mock('./reviewApi', () => ({ useSearchReviewersQuery: query }))

describe('directory state lifecycle', () => {
  beforeEach(() => { query.mockClear(); vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('keeps component instances independent and cancels an outstanding debounce on unmount', () => {
    const { result, unmount } = renderHook(() => ({ left: useReviewerDirectory(), right: useReviewerDirectory() }))
    act(() => result.current.left.setPage(3))
    act(() => result.current.left.changeSearch('  Cora  '))
    expect(result.current.left.page).toBe(1)
    expect(result.current.right.search).toBe('')
    act(() => vi.advanceTimersByTime(299))
    expect(query.mock.calls.some(([args]) => args.search === 'Cora')).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(query.mock.calls.at(-2)?.[0]).toEqual({ search: 'Cora', credential: undefined, page: 1 })
    expect(query.mock.calls.at(-1)?.[0]).toEqual({ search: undefined, credential: undefined, page: 1 })
    act(() => result.current.left.changeSearch('Not submitted before unmount'))
    unmount()
    const callsAtUnmount = query.mock.calls.length
    act(() => vi.advanceTimersByTime(500))
    expect(query).toHaveBeenCalledTimes(callsAtUnmount)
  })
})
