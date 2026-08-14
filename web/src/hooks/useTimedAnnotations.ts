import { useEffect, useRef, useState } from 'react'
import { computeActive, normalize, timingSignature, type CueSpec } from '@/lib/engine'

export type AnnotationDriver = 'texttrack' | 'rvfc' | 'timeupdate'

export interface UseTimedAnnotationsOptions {
  /**
   * Defaults to `rvfc` per SPIKE-RESULTS.md, measured against a real
   * H.264/AAC MP4 in `/__spikes`'s `CueTimingPanel` (STEP-00): `rvfc`
   * averaged ~11.5ms in Chrome and ~23.4ms in Safari — both far more
   * consistent than `texttrack`, whose ~5.8ms Chrome vs. ~118.8ms Safari
   * split is exactly the WebKit `cuechange` regression R1 warns about
   * (STEP-06-watch-commentary.md "Watch for"), and than `timeupdate`
   * (~69.2ms Chrome, ~118.4ms Safari — the browser-chosen 4-66Hz cadence,
   * suppressed while paused). `rvfc` wins on both browsers and is used
   * unless the caller overrides it or the browser doesn't implement
   * `requestVideoFrameCallback` at all, in which case this hook falls
   * back to `timeupdate`.
   */
  driver?: AnnotationDriver
}

/** Always-on reconciler interval while playing (MODERNIZATION_PLAN.md
 * §8.2) — costs ~5µs for 50 cues and turns WebKit's `cuechange` bug from a
 * broken feature into a precision regression. This runs regardless of
 * which driver is selected; it is the safety net, not an optimization
 * target. */
const RECONCILE_MS = 250

const METADATA_TRACK_LABEL = 'annotation-engine'

/** Shared identity for "nothing active" so resetting can bail out of the
 * state update instead of handing React a fresh empty Set every time. */
const EMPTY_ACTIVE: ReadonlySet<string> = new Set()

interface TrackEntry {
  track: TextTrack
  cuesById: Map<string, VTTCue>
}

/**
 * `addTextTrack()` has no inverse in the DOM (§8.2) — a new metadata
 * track leaks on every remount (panel toggle, route re-entry, StrictMode)
 * unless the track is cached per `<video>` element. `WeakMap` so the
 * cache doesn't itself keep a detached `<video>` alive.
 */
const trackCache = new WeakMap<HTMLVideoElement, TrackEntry>()

function rvfcSupported(): boolean {
  return (
    typeof HTMLVideoElement !== 'undefined' &&
    'requestVideoFrameCallback' in HTMLVideoElement.prototype
  )
}

function getOrCreateTrackEntry(video: HTMLVideoElement): TrackEntry {
  let entry = trackCache.get(video)
  if (!entry) {
    const track = video.addTextTrack('metadata', METADATA_TRACK_LABEL)
    track.mode = 'hidden'
    entry = { track, cuesById: new Map() }
    trackCache.set(video, entry)
  }
  return entry
}

/**
 * Rebuilds the cached metadata track's cues to match `cues`, incrementally:
 * a cue whose id already has a `VTTCue` gets its `startTime`/`endTime`
 * mutated in place (the spec's setters re-run "time marches on," so this
 * is complete, not a shortcut) rather than being torn down and recreated;
 * a genuinely new id gets a new `VTTCue`; an id no longer present gets
 * removed. Every `new VTTCue` is wrapped in `try/catch` — a `NaN` start
 * throws on construction and would otherwise abort the whole rebuild
 * mid-loop.
 */
function reconcileTrackCues(video: HTMLVideoElement, cues: readonly CueSpec[]): void {
  const entry = getOrCreateTrackEntry(video)
  const seen = new Set<string>()

  for (const c of cues) {
    const n = normalize(c)
    if (!n) continue
    seen.add(c.id)
    const existing = entry.cuesById.get(c.id)
    if (existing) {
      if (existing.startTime !== n.start) existing.startTime = n.start
      if (existing.endTime !== n.end) existing.endTime = n.end
      continue
    }
    try {
      const cue = new VTTCue(n.start, n.end, '')
      cue.id = c.id
      entry.track.addCue(cue)
      entry.cuesById.set(c.id, cue)
    } catch {
      // NaN/invalid start throws on construction — `normalize()` already
      // guards against NaN start (returns null, skipped above), but a
      // browser-specific rejection (e.g. end <= start after a float
      // rounding edge) must not abort the rest of the rebuild.
    }
  }

  for (const [id, cue] of entry.cuesById) {
    if (!seen.has(id)) {
      entry.track.removeCue(cue)
      entry.cuesById.delete(id)
    }
  }
}

function setEquals(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

/**
 * NOT unit-tested: jsdom implements neither `requestVideoFrameCallback`
 * nor a real `TextTrack`/`cuechange`, so the scrub-reactivation acceptance
 * criterion (scrubbing backwards/forwards re-activates the correct cues,
 * no ghosts/stuck overlays across all three drivers) can only be verified
 * in a real browser — Chrome, Safari, and iOS native fullscreen, per
 * STEP-06-watch-commentary.md's acceptance list. `lib/engine.test.ts`
 * covers the pure `computeActive`/`normalize`/`timingSignature` logic this
 * hook is built on exhaustively; this file's DOM wiring itself still needs
 * a manual/Playwright pass (see CP-06) before this criterion is checked off.
 */

/**
 * The engine's DOM-facing half (MODERNIZATION_PLAN.md §8.2). Derives the
 * active-cue set synchronously from `cues` + `videoEl.currentTime` on
 * every tick — never from `track.activeCues`, which the HTML spec defines
 * as stale by construction ("whose active flag was set when the script
 * started"). The cached `TextTrack` exists purely as a `cuechange` event
 * SOURCE for the `texttrack` driver; it is never read for its own
 * `activeCues` value.
 *
 * `videoEl` must be passed as render-triggering state (e.g. a callback
 * ref stored in `useState`), not a bare `ref.current` — a ref mutation
 * doesn't re-render, so this hook would never see the element and would
 * silently never attach (§8.2).
 */
export function useTimedAnnotations(
  videoEl: HTMLVideoElement | null,
  cues: readonly CueSpec[],
  opts: UseTimedAnnotationsOptions = {},
): ReadonlySet<string> {
  const requestedDriver = opts.driver ?? 'rvfc'
  const effectiveDriver: AnnotationDriver =
    requestedDriver === 'rvfc' && !rvfcSupported() ? 'timeupdate' : requestedDriver

  const [active, setActive] = useState<ReadonlySet<string>>(() => new Set())

  const cuesRef = useRef(cues)
  useEffect(() => {
    cuesRef.current = cues
  })

  const signature = timingSignature(cues)

  const publish = (video: HTMLVideoElement) => {
    const next = computeActive(cuesRef.current, video.currentTime)
    // Set-equality bail — an unchanged active set must not re-render the
    // overlay every 250ms (or every rvfc frame).
    setActive((prev) => (setEquals(prev, next) ? prev : next))
  }

  // Rebuild cues ONLY when the timing signature changes (or the video
  // element itself changes) — keyed on timing, not the annotation array,
  // so a body/topic/kind-only edit never triggers a rebuild and never
  // storms `cuechange`.
  useEffect(() => {
    if (!videoEl) {
      // No element means no driver and no reconciler are running, so
      // nothing would ever correct a set left over from the previous
      // element — return empty rather than a frozen active set (same reset
      // `useVideoCurrentTime` does). Identity-stable so this can't loop.
      const reset = () => setActive((prev) => (prev.size === 0 ? prev : EMPTY_ACTIVE))
      reset()
      return
    }
    reconcileTrackCues(videoEl, cuesRef.current)
    publish(videoEl)
  }, [videoEl, signature])

  // Drivers + always-on reconciler + correctness-on-scrub listeners.
  useEffect(() => {
    if (!videoEl) return

    const recompute = () => publish(videoEl)

    // Correctness on scrub: re-derive on every event that can change
    // `currentTime`, playback state, or reload the element — including
    // scrubbing backwards/forwards past an already-fired cue, which must
    // re-activate it (STEP-06's acceptance criteria).
    const correctnessEvents = [
      'seeked',
      'seeking',
      'loadedmetadata',
      'ratechange',
      'play',
      'pause',
      'ended',
      'emptied',
    ] as const
    for (const event of correctnessEvents) videoEl.addEventListener(event, recompute)

    let reconcileId: ReturnType<typeof setInterval> | null = null
    const startReconciler = () => {
      if (reconcileId !== null) return
      reconcileId = setInterval(recompute, RECONCILE_MS)
    }
    const stopReconciler = () => {
      if (reconcileId === null) return
      clearInterval(reconcileId)
      reconcileId = null
    }
    videoEl.addEventListener('play', startReconciler)
    videoEl.addEventListener('pause', stopReconciler)
    videoEl.addEventListener('ended', stopReconciler)
    videoEl.addEventListener('emptied', stopReconciler)
    if (!videoEl.paused) startReconciler()

    let cleanupDriver: (() => void) | undefined

    if (effectiveDriver === 'texttrack') {
      const entry = getOrCreateTrackEntry(videoEl)
      entry.track.addEventListener('cuechange', recompute)
      cleanupDriver = () => entry.track.removeEventListener('cuechange', recompute)
    } else if (effectiveDriver === 'rvfc') {
      let rvfcId: number | null = null
      const onFrame: VideoFrameRequestCallback = () => {
        recompute()
        rvfcId = videoEl.requestVideoFrameCallback(onFrame)
      }
      rvfcId = videoEl.requestVideoFrameCallback(onFrame)
      cleanupDriver = () => {
        if (rvfcId !== null) videoEl.cancelVideoFrameCallback(rvfcId)
      }
    } else {
      videoEl.addEventListener('timeupdate', recompute)
      cleanupDriver = () => videoEl.removeEventListener('timeupdate', recompute)
    }

    recompute() // sync immediately on (re)attach, don't wait for the first tick

    return () => {
      for (const event of correctnessEvents) videoEl.removeEventListener(event, recompute)
      videoEl.removeEventListener('play', startReconciler)
      videoEl.removeEventListener('pause', stopReconciler)
      videoEl.removeEventListener('ended', stopReconciler)
      videoEl.removeEventListener('emptied', stopReconciler)
      stopReconciler()
      cleanupDriver?.()
    }
  }, [videoEl, effectiveDriver])

  return active
}
