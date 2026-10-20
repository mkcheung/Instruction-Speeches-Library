import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { NOMINAL_FRAME_SECONDS, useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import type { KeyboardShortcutAnnotation } from '@/hooks/useKeyboardShortcuts'

/**
 * IMPLEMENTATION-PLANS.md §7.7.6 — the keyboard map's typing guard, the
 * one contested key (`Space`), and the textarea-specific `C`/`Alt+C`
 * carve-out. jsdom has no real layout or a playing video, but every one of
 * these behaviours is pure "does the right callback fire for the right
 * key, given the right focused element" logic, which jsdom's DOM/focus
 * model is perfectly adequate for — the real-browser cases (actual seeking,
 * actual focus order) are `web/tests/keyboard-shortcuts.spec.ts`'s job.
 */

function dispatchKeyDown(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

function makeVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'play', { value: vi.fn().mockResolvedValue(undefined), configurable: true })
  Object.defineProperty(video, 'pause', { value: vi.fn(), configurable: true })
  Object.defineProperty(video, 'currentTime', { value: 10, writable: true, configurable: true })
  Object.defineProperty(video, 'duration', { value: 100, writable: true, configurable: true })
  Object.defineProperty(video, 'paused', { value: true, writable: true, configurable: true })
  Object.assign(video, overrides)
  return video
}

describe('useKeyboardShortcuts', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('J seeks back 5s and L seeks forward 5s on the video element', () => {
    const video = makeVideo({ currentTime: 20 } as Partial<HTMLVideoElement>)
    const onSeek = vi.fn()
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek }))

    dispatchKeyDown(document.body, { code: 'KeyJ', key: 'j' })
    expect(video.currentTime).toBe(15)

    dispatchKeyDown(document.body, { code: 'KeyL', key: 'l' })
    expect(video.currentTime).toBe(20)
  })

  it('J never seeks below 0', () => {
    const video = makeVideo({ currentTime: 2 } as Partial<HTMLVideoElement>)
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn() }))

    dispatchKeyDown(document.body, { code: 'KeyJ', key: 'j' })
    expect(video.currentTime).toBe(0)
  })

  it(', steps back one nominal frame and . steps forward one nominal frame', () => {
    const video = makeVideo({ currentTime: 10 } as Partial<HTMLVideoElement>)
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn() }))

    dispatchKeyDown(document.body, { code: 'Comma', key: ',' })
    expect(video.currentTime).toBeCloseTo(10 - NOMINAL_FRAME_SECONDS, 6)

    // Back to a clean baseline, then forward.
    video.currentTime = 10
    dispatchKeyDown(document.body, { code: 'Period', key: '.' })
    expect(video.currentTime).toBeCloseTo(10 + NOMINAL_FRAME_SECONDS, 6)
  })

  it('[ and ] seek to the previous/next annotation relative to the playhead', () => {
    const video = makeVideo({ currentTime: 10 } as Partial<HTMLVideoElement>)
    const onSeek = vi.fn()
    const annotations: KeyboardShortcutAnnotation[] = [
      { id: 'a', start_seconds: 2 },
      { id: 'b', start_seconds: 8 },
      { id: 'c', start_seconds: 15 },
      { id: 'd', start_seconds: 30 },
    ]
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations, onSeek }))

    dispatchKeyDown(document.body, { code: 'BracketRight', key: ']' })
    expect(onSeek).toHaveBeenLastCalledWith(15)

    dispatchKeyDown(document.body, { code: 'BracketLeft', key: '[' })
    expect(onSeek).toHaveBeenLastCalledWith(8)
  })

  it('Space toggles play/pause when focus is not on a button/link', () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>)
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn() }))

    dispatchKeyDown(document.body, { code: 'Space', key: ' ' })
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(video.pause).not.toHaveBeenCalled()
  })

  it('Space does NOT toggle play/pause when a <button> is focused', () => {
    const button = document.createElement('button')
    container.appendChild(button)
    button.focus()

    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>)
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn() }))

    dispatchKeyDown(button, { code: 'Space', key: ' ' })
    expect(video.play).not.toHaveBeenCalled()
    expect(video.pause).not.toHaveBeenCalled()
  })

  it('Space does NOT toggle play/pause when a radio or checkbox is focused', () => {
    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>)
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn() }))

    for (const type of ['radio', 'checkbox']) {
      const input = document.createElement('input')
      input.type = type
      container.appendChild(input)
      input.focus()
      const event = dispatchKeyDown(input, { code: 'Space', key: ' ' })
      expect(event?.defaultPrevented ?? false).toBe(false)
    }
    expect(video.play).not.toHaveBeenCalled()
    expect(video.pause).not.toHaveBeenCalled()
  })

  it('Space does NOT fire when focus is on an <a href> or role=button element', () => {
    const link = document.createElement('a')
    link.href = '#'
    const roleButton = document.createElement('div')
    roleButton.setAttribute('role', 'button')
    container.appendChild(link)
    container.appendChild(roleButton)

    const video = makeVideo({ paused: true } as Partial<HTMLVideoElement>)
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn() }))

    dispatchKeyDown(link, { code: 'Space', key: ' ' })
    dispatchKeyDown(roleButton, { code: 'Space', key: ' ' })
    expect(video.play).not.toHaveBeenCalled()
  })

  it('the typing guard excludes a contenteditable host (essay editor) for J/L/[/ ]', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    container.appendChild(editable)
    editable.focus()

    const video = makeVideo({ currentTime: 20 } as Partial<HTMLVideoElement>)
    const onSeek = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({
        videoEl: video,
        annotations: [{ id: 'a', start_seconds: 1 }],
        onSeek,
      }),
    )

    dispatchKeyDown(editable, { code: 'KeyJ', key: 'j' })
    expect(video.currentTime).toBe(20) // unchanged

    dispatchKeyDown(editable, { code: 'BracketLeft', key: '[' })
    expect(onSeek).not.toHaveBeenCalled()
  })

  it('the typing guard excludes a <textarea> for J/L', () => {
    const textarea = document.createElement('textarea')
    container.appendChild(textarea)
    textarea.focus()

    const video = makeVideo({ currentTime: 20 } as Partial<HTMLVideoElement>)
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn() }))

    dispatchKeyDown(textarea, { code: 'KeyJ', key: 'j' })
    expect(video.currentTime).toBe(20)
  })

  it('the typing guard excludes a <select> for J/L and bare C (code-review fix: the Kind dropdown)', () => {
    const select = document.createElement('select')
    const option = document.createElement('option')
    option.value = 'correction'
    select.appendChild(option)
    container.appendChild(select)
    select.focus()

    const video = makeVideo({ currentTime: 20 } as Partial<HTMLVideoElement>)
    const setToPlayhead = vi.fn()
    renderHook(() =>
      useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn(), setToPlayhead }),
    )

    // Type-ahead to "correction" must not also re-stamp the timestamp.
    dispatchKeyDown(select, { code: 'KeyC', key: 'c' })
    expect(setToPlayhead).not.toHaveBeenCalled()

    dispatchKeyDown(select, { code: 'KeyJ', key: 'j' })
    expect(video.currentTime).toBe(20) // unchanged

    // Space must stay free to open the native dropdown, not toggle play/pause.
    const event = dispatchKeyDown(select, { code: 'Space', key: ' ' })
    expect(video.play).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('the typing guard excludes a text <input> but NOT a checkbox input', () => {
    const textInput = document.createElement('input')
    textInput.type = 'text'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    container.appendChild(textInput)
    container.appendChild(checkbox)

    const video = makeVideo({ currentTime: 20 } as Partial<HTMLVideoElement>)
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn() }))

    textInput.focus()
    dispatchKeyDown(textInput, { code: 'KeyJ', key: 'j' })
    expect(video.currentTime).toBe(20) // excluded, unchanged

    checkbox.focus()
    dispatchKeyDown(checkbox, { code: 'KeyJ', key: 'j' })
    expect(video.currentTime).toBe(15) // checkbox is a control, not text entry
  })

  describe('C / Alt+C — stamp timestamp at playhead', () => {
    it('bare C fires globally when focus is not in a typing context', () => {
      const setToPlayhead = vi.fn()
      const video = makeVideo()
      renderHook(() =>
        useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn(), setToPlayhead }),
      )

      dispatchKeyDown(document.body, { code: 'KeyC', key: 'c' })
      expect(setToPlayhead).toHaveBeenCalledTimes(1)
    })

    it('bare c inside a <textarea> does NOT stamp (it must insert the letter instead)', () => {
      const textarea = document.createElement('textarea')
      container.appendChild(textarea)
      textarea.focus()

      const setToPlayhead = vi.fn()
      const video = makeVideo()
      renderHook(() =>
        useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn(), setToPlayhead }),
      )

      dispatchKeyDown(textarea, { code: 'KeyC', key: 'c' })
      expect(setToPlayhead).not.toHaveBeenCalled()
    })

    it('Alt+C inside a <textarea> DOES stamp, keyed off event.code (not event.key)', () => {
      const textarea = document.createElement('textarea')
      container.appendChild(textarea)
      textarea.focus()

      const setToPlayhead = vi.fn()
      const video = makeVideo()
      renderHook(() =>
        useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn(), setToPlayhead }),
      )

      // macOS Option+C produces the character "ç" — event.key would never
      // equal 'c' here, which is exactly why the hook keys off event.code.
      const event = dispatchKeyDown(textarea, { code: 'KeyC', key: 'ç', altKey: true })
      expect(setToPlayhead).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
    })

    it('bare C does NOT fire inside a contenteditable host (essay editor)', () => {
      const editable = document.createElement('div')
      editable.setAttribute('contenteditable', 'true')
      container.appendChild(editable)
      editable.focus()

      const setToPlayhead = vi.fn()
      renderHook(() =>
        useKeyboardShortcuts({
          videoEl: makeVideo(),
          annotations: [],
          onSeek: vi.fn(),
          setToPlayhead,
        }),
      )

      dispatchKeyDown(editable, { code: 'KeyC', key: 'c' })
      expect(setToPlayhead).not.toHaveBeenCalled()
    })

    it('is a no-op when setToPlayhead is undefined (read-only viewer)', () => {
      renderHook(() => useKeyboardShortcuts({ videoEl: makeVideo(), annotations: [], onSeek: vi.fn() }))
      expect(() => dispatchKeyDown(document.body, { code: 'KeyC', key: 'c' })).not.toThrow()
    })
  })

  it('does nothing when enabled is false', () => {
    const video = makeVideo({ currentTime: 20 } as Partial<HTMLVideoElement>)
    renderHook(() => useKeyboardShortcuts({ videoEl: video, annotations: [], onSeek: vi.fn(), enabled: false }))

    dispatchKeyDown(document.body, { code: 'KeyJ', key: 'j' })
    expect(video.currentTime).toBe(20)
  })
})
