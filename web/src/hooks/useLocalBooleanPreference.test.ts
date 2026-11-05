import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalBooleanPreference } from '@/hooks/useLocalBooleanPreference'

const KEY = 'annotation-composer:voice-autoplay'
function renderPref(userId: string | undefined, defaultValue = true) {
  return renderHook(() => useLocalBooleanPreference({ key: KEY, userId, defaultValue }))
}

describe('useLocalBooleanPreference', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('defaults when nothing is stored', () => {
    expect(renderPref('3').result.current[0]).toBe(true)
    expect(renderPref('3', false).result.current[0]).toBe(false)
  })

  it('honors a stored false and true', () => {
    localStorage.setItem(`${KEY}:3`, 'false')
    expect(renderPref('3').result.current[0]).toBe(false)
    localStorage.setItem(`${KEY}:3`, 'true')
    expect(renderPref('3', false).result.current[0]).toBe(true)
  })

  it('pins the literal stored key annotation-composer:voice-autoplay:3', () => {
    const { result } = renderPref('3')
    act(() => result.current[1](false))
    expect(localStorage.getItem('annotation-composer:voice-autoplay:3')).toBe('false')
    expect(result.current[0]).toBe(false)
  })

  it('keeps preferences per user', () => {
    localStorage.setItem(`${KEY}:3`, 'false')
    expect(renderPref('4').result.current[0]).toBe(true)
  })

  it('with no userId returns the default and writes nothing', () => {
    const { result } = renderPref(undefined)
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
    expect(localStorage.length).toBe(0)
  })

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const { result } = renderPref('3')
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
  })

  it('re-reads storage when the user changes', () => {
    localStorage.setItem(`${KEY}:4`, 'false')
    const { result, rerender } = renderHook(({ id }) => useLocalBooleanPreference({ key: KEY, userId: id, defaultValue: true }),
      { initialProps: { id: '3' } })
    expect(result.current[0]).toBe(true)
    rerender({ id: '4' })
    expect(result.current[0]).toBe(false)
  })
})
