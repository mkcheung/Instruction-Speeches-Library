import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTimedAnnotations } from '@/hooks/useTimedAnnotations'
import { lastFakeTextTrack } from '@/test/setup'
import type { CueSpec } from '@/lib/engine'

/**
 * STEP-07-write-commentary.md's named acceptance criterion: "Ten
 * body-only keystrokes produce zero `addCue`/`removeCue` calls —
 * asserted with a spy. The timing-signature rule is the difference
 * between a working preview and one that storms `cuechange` every
 * 750 ms."
 *
 * The composer merges its draft `Annotation` (which carries `body`) into
 * the SAME array passed as `cues` here — but `useTimedAnnotations`/
 * `timingSignature` only ever reads `id`/`start_seconds`/
 * `duration_seconds` off each entry (`lib/engine.ts`), so a body-only
 * change producing a brand-new array/object reference every keystroke (as
 * React state naturally does) must NOT re-trigger the cue rebuild that
 * calls `addCue`/`removeCue`. This is exercised directly against the hook
 * rather than through the full composer UI, since the hook is the actual
 * mechanism the acceptance criterion is about.
 */
describe('useTimedAnnotations — timing-signature rebuild gate (STEP-07)', () => {
  it('produces zero addCue/removeCue calls across ten body-only edits', () => {
    const video = document.createElement('video')
    const initialCues: CueSpec[] = [{ id: 'a', start_seconds: 10, duration_seconds: 6 }]

    const { rerender } = renderHook(
      ({ videoEl, cues }: { videoEl: HTMLVideoElement | null; cues: CueSpec[] }) =>
        useTimedAnnotations(videoEl, cues),
      { initialProps: { videoEl: video, cues: initialCues } },
    )

    const track = lastFakeTextTrack
    expect(track).not.toBeNull()
    expect(track!.addCue).toHaveBeenCalledTimes(1) // initial mount builds the one cue

    track!.addCue.mockClear()
    track!.removeCue.mockClear()

    // Ten "keystrokes": a brand-new cues array each time (exactly what a
    // merged-in draft `Annotation[]` produces on every render while typing)
    // but IDENTICAL start/duration — only `body` would have changed, and
    // `body` isn't even part of `CueSpec`.
    for (let i = 0; i < 10; i++) {
      const nextCues: CueSpec[] = [{ id: 'a', start_seconds: 10, duration_seconds: 6 }]
      rerender({ videoEl: video, cues: nextCues })
    }

    expect(track!.addCue).not.toHaveBeenCalled()
    expect(track!.removeCue).not.toHaveBeenCalled()
  })

  it('DOES call addCue for a genuinely new id (control case)', () => {
    // Proves the gate above isn't just permanently frozen — it correctly
    // ignores a body-only change while still reacting to an actual timing
    // change (a new cue appearing changes the timing signature).
    const video = document.createElement('video')
    const { rerender } = renderHook(
      ({ videoEl, cues }: { videoEl: HTMLVideoElement | null; cues: CueSpec[] }) =>
        useTimedAnnotations(videoEl, cues),
      { initialProps: { videoEl: video, cues: [{ id: 'a', start_seconds: 10, duration_seconds: 6 }] } },
    )

    const track = lastFakeTextTrack
    track!.addCue.mockClear()

    rerender({
      videoEl: video,
      cues: [
        { id: 'a', start_seconds: 10, duration_seconds: 6 },
        { id: 'b', start_seconds: 20, duration_seconds: 6 },
      ],
    })

    expect(track!.addCue).toHaveBeenCalledTimes(1)
  })
})
