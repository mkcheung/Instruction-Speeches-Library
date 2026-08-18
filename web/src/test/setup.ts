import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

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

/**
 * RTK Query's `autoBatchEnhancer` schedules its dispatch flush via
 * `requestAnimationFrame`/`cancelAnimationFrame` by default. jsdom DOES
 * define both natively (confirmed directly — this is not a bare-jsdom gap),
 * but `vi.useFakeTimers()` replaces them with fake versions while active,
 * and this codebase's own `afterEach(() => vi.useRealTimers())` convention
 * restores whatever was captured as "original" at install time. A batch
 * callback scheduled by RTK while fake timers were active, but not yet
 * fired by the time that test ends, can still be pending when a LATER,
 * unrelated test file's real timers eventually tick it — and calling
 * `cancelAnimationFrame` at that point has, intermittently in CI (not
 * reliably reproducible locally — it depends on cross-file timing that
 * differs by worker count/scheduling), thrown `ReferenceError:
 * cancelAnimationFrame is not defined`. The exact mechanism by which the
 * function goes missing again after being defined is not fully pinned
 * down; what matters is that neither function may ever be ABSENT, so this
 * guard runs both at load time and after every single test (not just once
 * per file) to repair whatever fake-timer install/uninstall cycles leave
 * behind, closing the observed crash regardless of root cause.
 */
function ensureAnimationFrameGlobals(): void {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      setTimeout(() => callback(Date.now()), 16) as unknown as number
  }
  if (typeof globalThis.cancelAnimationFrame !== 'function') {
    globalThis.cancelAnimationFrame = (handle: number): void => clearTimeout(handle)
  }
}
ensureAnimationFrameGlobals()
afterEach(ensureAnimationFrameGlobals)
