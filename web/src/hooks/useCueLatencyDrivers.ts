import { useCallback, useEffect, useRef, useState } from 'react'
import { computeActive, normalize, type CueSpec } from '@/lib/engine'

export type DriverName = 'texttrack' | 'rvfc' | 'timeupdate'

export interface LatencyRow {
  driver: DriverName
  cueId: string
  /**
   * Milliseconds between the interpolated wall-clock moment
   * `video.currentTime` crossed the cue's `start` and the moment this
   * driver's event fired and reported the cue as newly active. Negative
   * values mean the driver technically fired before the crossing sample
   * (interpolation error at low frame rates).
   */
  latencyMs: number
}

interface GroundTruthSample {
  wallMs: number
  currentTime: number
}

const RVFC_SUPPORTED =
  typeof window !== 'undefined' &&
  'requestVideoFrameCallback' in HTMLVideoElement.prototype

/**
 * Panel (c)'s instrumentation: drives three independent cue-boundary
 * detectors — `texttrack` (a hidden TextTrack's `cuechange`),
 * `requestVideoFrameCallback` (`rvfc`, one callback per decoded frame), and
 * `timeupdate` (the ~4-66 Hz fallback) — over the SAME fixture array and
 * measures, per driver, the latency between the wall-clock instant
 * `video.currentTime` crosses a cue's `normalize()`d start (the ground
 * truth §8.2 says the overlay should use) and the instant that driver's
 * event fires and reports the cue as newly active.
 *
 * Ground truth is reconstructed from a dense requestAnimationFrame sampler
 * that records (wallClockMs, currentTime) pairs and linearly interpolates
 * the wall-clock instant currentTime must have crossed each cue's start —
 * this sampler is infrastructure, not a fourth driver in the results.
 *
 * NOTE: this can only produce real numbers when playing an actual video in
 * an actual browser. It is built and exported correctly; the numbers in
 * the table only mean something once a human runs this in Chrome/Safari
 * against a real file.
 */
export function useCueLatencyDrivers(
  video: HTMLVideoElement | null,
  cues: readonly CueSpec[],
) {
  const [rows, setRows] = useState<LatencyRow[]>([])
  const [running, setRunning] = useState(false)

  const samplesRef = useRef<GroundTruthSample[]>([])
  const seenRef = useRef<Record<DriverName, Set<string>>>({
    texttrack: new Set(),
    rvfc: new Set(),
    timeupdate: new Set(),
  })
  const rafIdRef = useRef<number | null>(null)
  const rvfcIdRef = useRef<number | null>(null)
  const trackRef = useRef<TextTrack | null>(null)

  const expectedCrossingMs = useCallback((cueStart: number): number | null => {
    const samples = samplesRef.current
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1]
      const cur = samples[i]
      if (prev.currentTime <= cueStart && cueStart < cur.currentTime) {
        const span = cur.currentTime - prev.currentTime
        const frac = span === 0 ? 0 : (cueStart - prev.currentTime) / span
        return prev.wallMs + frac * (cur.wallMs - prev.wallMs)
      }
    }
    // No bracketing pair yet (e.g. cue already active before sampling
    // started, or sampling hasn't caught up) — fall back to the most
    // recent sample as a best-effort reference point.
    const last = samples[samples.length - 1]
    return last ? last.wallMs : null
  }, [])

  const recordActivation = useCallback(
    (driver: DriverName, cueId: string, nowMs: number) => {
      const seen = seenRef.current[driver]
      if (seen.has(cueId)) return
      seen.add(cueId)
      const cue = cues.find((c) => c.id === cueId)
      if (!cue) return
      const n = normalize(cue)
      if (!n) return
      const expected = expectedCrossingMs(n.start)
      if (expected === null) return
      setRows((prev) => [
        ...prev,
        { driver, cueId, latencyMs: nowMs - expected },
      ])
    },
    [cues, expectedCrossingMs],
  )

  const start = useCallback(() => {
    if (!video) return
    setRows([])
    samplesRef.current = []
    seenRef.current = {
      texttrack: new Set(),
      rvfc: new Set(),
      timeupdate: new Set(),
    }
    setRunning(true)

    // Ground-truth sampler.
    const sample = () => {
      samplesRef.current.push({
        wallMs: performance.now(),
        currentTime: video.currentTime,
      })
      // Bound memory for long-running sessions.
      if (samplesRef.current.length > 10_000) {
        samplesRef.current.splice(0, samplesRef.current.length - 10_000)
      }
      rafIdRef.current = requestAnimationFrame(sample)
    }
    rafIdRef.current = requestAnimationFrame(sample)

    // Driver 1: texttrack (hidden metadata track, same normalize()).
    const track = video.addTextTrack('metadata', 'spike-cues')
    track.mode = 'hidden'
    for (const c of cues) {
      const n = normalize(c)
      if (!n) continue
      try {
        const VTTCueCtor = (window as unknown as { VTTCue?: typeof VTTCue })
          .VTTCue
        if (!VTTCueCtor) continue
        const cue = new VTTCueCtor(n.start, n.end, '')
        cue.id = c.id
        track.addCue(cue)
      } catch {
        // A NaN/invalid start throws on construction — skip, matches the
        // engine's own null-normalization contract.
      }
    }
    trackRef.current = track
    const onCueChange = () => {
      const now = performance.now()
      const active = track.activeCues
      if (!active) return
      for (let i = 0; i < active.length; i++) {
        const id = (active[i] as unknown as { id: string }).id
        recordActivation('texttrack', id, now)
      }
    }
    track.addEventListener('cuechange', onCueChange)

    // Driver 2: requestVideoFrameCallback (if supported).
    if (RVFC_SUPPORTED) {
      const onFrame = (
        _now: DOMHighResTimeStamp,
        metadata: VideoFrameCallbackMetadata,
      ) => {
        const wallMs = performance.now()
        const active = computeActive(cues, metadata.mediaTime)
        for (const id of active) recordActivation('rvfc', id, wallMs)
        rvfcIdRef.current = (
          video as unknown as {
            requestVideoFrameCallback: (
              cb: (
                now: DOMHighResTimeStamp,
                metadata: VideoFrameCallbackMetadata,
              ) => void,
            ) => number
          }
        ).requestVideoFrameCallback(onFrame)
      }
      rvfcIdRef.current = (
        video as unknown as {
          requestVideoFrameCallback: (
            cb: (
              now: DOMHighResTimeStamp,
              metadata: VideoFrameCallbackMetadata,
            ) => void,
          ) => number
        }
      ).requestVideoFrameCallback(onFrame)
    }

    // Driver 3: timeupdate (last resort — browser-chosen 4-66 Hz, suppressed while paused).
    const onTimeUpdate = () => {
      const now = performance.now()
      const active = computeActive(cues, video.currentTime)
      for (const id of active) recordActivation('timeupdate', id, now)
    }
    video.addEventListener('timeupdate', onTimeUpdate)

    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
      if (rvfcIdRef.current !== null && RVFC_SUPPORTED) {
        ;(
          video as unknown as { cancelVideoFrameCallback: (id: number) => void }
        ).cancelVideoFrameCallback(rvfcIdRef.current)
      }
      track.removeEventListener('cuechange', onCueChange)
      video.removeEventListener('timeupdate', onTimeUpdate)
      // `addTextTrack()` has no inverse in the DOM (§8.2) — the track is
      // set back to disabled so it stops doing work, but it cannot be
      // detached from the element. A production hook must cache one track
      // per `<video>` in a WeakMap for this reason; this harness is
      // single-run per mount so the leak is bounded.
      track.mode = 'disabled'
    }
  }, [video, cues, recordActivation])

  const cleanupRef = useRef<(() => void) | null>(null)

  const startAndTrack = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = start() ?? null
  }, [start])

  const stop = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setRunning(false)
  }, [])

  useEffect(() => () => cleanupRef.current?.(), [])

  return { rows, running, start: startAndTrack, stop, rvfcSupported: RVFC_SUPPORTED }
}
