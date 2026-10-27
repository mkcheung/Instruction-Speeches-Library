import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUsernameAvailability } from './useUsernameAvailability'

interface Deferred {
  username: string
  resolve: (available: boolean) => void
  reject: () => void
}

const calls: Deferred[] = []
const trigger = vi.fn((username: string) => {
  let resolve!: (v: { available: boolean }) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<{ available: boolean }>((res, rej) => {
    resolve = res
    reject = rej
  })
  calls.push({ username, resolve: (available) => resolve({ available }), reject: () => reject(new Error('x')) })
  return { unwrap: () => promise }
})

vi.mock('@/features/profile/profileApi', () => ({
  useLazyCheckUsernameAvailabilityQuery: () => [trigger],
}))

async function settle(fn: () => void) {
  await act(async () => {
    fn()
    await Promise.resolve()
  })
}

const advance = (ms = 400) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('useUsernameAvailability', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    calls.length = 0
    trigger.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('debounces 400ms then reports the result', async () => {
    const { result } = renderHook(({ u }) => useUsernameAvailability(u), { initialProps: { u: 'alice' } })
    await advance(399)
    expect(trigger).not.toHaveBeenCalled()
    expect(result.current.status).toBe('checking')
    await advance(1)
    await settle(() => calls[0].resolve(true))
    expect(result.current.status).toBe('available')
  })

  it('ignores an older success that resolves after the newer one', async () => {
    const { result, rerender } = renderHook(({ u }) => useUsernameAvailability(u), { initialProps: { u: 'alice' } })
    await advance()
    rerender({ u: 'alicia' })
    await advance()
    expect(calls.map((c) => c.username)).toEqual(['alice', 'alicia'])
    await settle(() => calls[1].resolve(false))
    expect(result.current.status).toBe('taken')
    await settle(() => calls[0].resolve(true))
    expect(result.current.status).toBe('taken')
  })

  it('ignores an older success that resolves before the newer one', async () => {
    const { result, rerender } = renderHook(({ u }) => useUsernameAvailability(u), { initialProps: { u: 'alice' } })
    await advance()
    rerender({ u: 'alicia' })
    await advance()
    await settle(() => calls[0].resolve(true))
    expect(result.current.status).toBe('checking')
    await settle(() => calls[1].resolve(false))
    expect(result.current.status).toBe('taken')
  })

  it('ignores an obsolete rejection', async () => {
    const { result, rerender } = renderHook(({ u }) => useUsernameAvailability(u), { initialProps: { u: 'alice' } })
    await advance()
    rerender({ u: 'alicia' })
    await advance()
    await settle(() => calls[1].resolve(true))
    await settle(() => calls[0].reject())
    expect(result.current.status).toBe('available')
  })

  it('reports unknown when the current request fails', async () => {
    const { result } = renderHook(({ u }) => useUsernameAvailability(u), { initialProps: { u: 'alice' } })
    await advance()
    await settle(() => calls[0].reject())
    expect(result.current.status).toBe('unknown')
  })

  it('A->B->A uses request identity: the first A reply is ignored', async () => {
    const { result, rerender } = renderHook(({ u }) => useUsernameAvailability(u), { initialProps: { u: 'alice' } })
    await advance()
    rerender({ u: 'alicia' })
    await advance()
    rerender({ u: 'alice' })
    await advance()
    expect(calls.map((c) => c.username)).toEqual(['alice', 'alicia', 'alice'])
    await settle(() => calls[0].resolve(false))
    expect(result.current.status).toBe('checking')
    await settle(() => calls[2].resolve(true))
    expect(result.current.status).toBe('available')
  })

  it('skips malformed input and drops replies once input becomes invalid', async () => {
    const { result, rerender } = renderHook(({ u }) => useUsernameAvailability(u), { initialProps: { u: 'alice' } })
    await advance()
    rerender({ u: '!' })
    expect(result.current.status).toBe('idle')
    await advance()
    expect(trigger).toHaveBeenCalledTimes(1)
    await settle(() => calls[0].resolve(true))
    expect(result.current.status).toBe('idle')
    rerender({ u: 'alice' })
    expect(result.current.status).toBe('checking')
  })

  it('does not set state or call after unmount', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderHook(({ u }) => useUsernameAvailability(u), { initialProps: { u: 'alice' } })
    await advance()
    unmount()
    await settle(() => calls[0].resolve(true))
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
