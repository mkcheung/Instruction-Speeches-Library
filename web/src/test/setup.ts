import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

/**
 * STEP-07-write-commentary.md's acceptance list ("ten body-only keystrokes
 * produce zero `addCue`/`removeCue` calls — asserted with a spy") needs
 * `useTimedAnnotations.ts` (STEP-06) to actually run against something —
 * but jsdom implements neither `HTMLMediaElement.addTextTrack()` nor
 * `TextTrack`/`VTTCue` as globals. Stubbed globally, once, here (rather
 * than per test file) so any test that mounts a `<video>` and calls the
 * hook gets a working, spy-able metadata track with no boilerplate of its
 * own.
 *
 * A real browser's `addTextTrack()` returns a NEW `TextTrack` on every
 * call; this stub does the same. `useTimedAnnotations`'s own `WeakMap`
 * cache (§8.2: "`addTextTrack()` has no inverse in the DOM") ensures it's
 * only ever called once per real `<video>` element, so `lastFakeTextTrack`
 * below is sufficient for any test that mounts exactly one `<video>` —
 * every test in this suite that needs this.
 */
export class FakeVTTCue {
  id = ''
  startTime: number
  endTime: number
  text: string
  constructor(startTime: number, endTime: number, text: string) {
    this.startTime = startTime
    this.endTime = endTime
    this.text = text
  }
}

export class FakeTextTrack extends EventTarget {
  mode = 'hidden'
  addCue = vi.fn()
  removeCue = vi.fn()
}

/** The most recently created fake track. */
export let lastFakeTextTrack: FakeTextTrack | null = null

if (typeof (globalThis as { VTTCue?: unknown }).VTTCue === 'undefined') {
  ;(globalThis as unknown as { VTTCue: typeof FakeVTTCue }).VTTCue = FakeVTTCue
}

// Unconditional override, not a `!HTMLMediaElement.prototype.addTextTrack`
// existence guard: jsdom actually DEFINES `addTextTrack` already, as a
// stub that logs "Not implemented" and returns nothing — so an existence
// check would never trigger the override, and the hook's real code path
// would silently throw at `track.mode = 'hidden'` on an `undefined` track.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.addTextTrack = function addTextTrack() {
    const track = new FakeTextTrack()
    lastFakeTextTrack = track
    return track as unknown as TextTrack
  }
}
