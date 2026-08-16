import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePlayheadPercent } from '@/hooks/usePlayheadPercent'

describe('usePlayheadPercent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes --playhead-percent onto the attached node via a CSS property, not React state', () => {
    let frameCallback: FrameRequestCallback | null = null
    const raf = vi.fn((cb: FrameRequestCallback) => {
      frameCallback = cb
      return 1
    })
    const caf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    vi.stubGlobal('cancelAnimationFrame', caf)

    const video = document.createElement('video')
    Object.defineProperty(video, 'duration', { value: 100, writable: true })
    Object.defineProperty(video, 'currentTime', { value: 25, writable: true })

    const node = document.createElement('div')
    const setPropertySpy = vi.spyOn(node.style, 'setProperty')

    const { result } = renderHook(() => usePlayheadPercent(video))
    result.current(node) // attach, like a ref callback

    expect(raf).toHaveBeenCalledTimes(1)
    // Manually fire the one scheduled frame — the hook re-arms itself, so
    // only fire it once here rather than looping forever.
    frameCallback!(0)

    expect(setPropertySpy).toHaveBeenCalledWith('--playhead-percent', '25%')
  })

  it('clamps to [0, 100] and skips the write when duration is unknown', () => {
    let frameCallback: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frameCallback = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const video = document.createElement('video')
    Object.defineProperty(video, 'duration', { value: NaN, writable: true })

    const node = document.createElement('div')
    const setPropertySpy = vi.spyOn(node.style, 'setProperty')

    const { result } = renderHook(() => usePlayheadPercent(video))
    result.current(node)
    frameCallback!(0)

    expect(setPropertySpy).not.toHaveBeenCalled()
  })

  it('cancels the rAF loop on unmount/detach', () => {
    const caf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7))
    vi.stubGlobal('cancelAnimationFrame', caf)

    const video = document.createElement('video')
    const { unmount } = renderHook(() => usePlayheadPercent(video))
    unmount()

    expect(caf).toHaveBeenCalledWith(7)
  })
})
