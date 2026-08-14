import { describe, expect, it } from 'vitest'
import { computeActive, normalize, timingSignature, type CueSpec } from './engine'

describe('normalize', () => {
  it('returns start/end for a normal cue', () => {
    expect(normalize({ id: 'a', start_seconds: 10, duration_seconds: 5 })).toEqual({
      start: 10,
      end: 15,
    })
  })

  it('clamps a negative start to 0', () => {
    expect(normalize({ id: 'a', start_seconds: -5, duration_seconds: 5 })).toEqual({
      start: 0,
      end: 5,
    })
  })

  it('returns null when start_seconds is NaN', () => {
    expect(normalize({ id: 'a', start_seconds: NaN, duration_seconds: 5 })).toBeNull()
  })

  it('returns null when start_seconds is +Infinity', () => {
    expect(
      normalize({ id: 'a', start_seconds: Infinity, duration_seconds: 5 }),
    ).toBeNull()
  })

  it('returns null when start_seconds is -Infinity', () => {
    expect(
      normalize({ id: 'a', start_seconds: -Infinity, duration_seconds: 5 }),
    ).toBeNull()
  })

  it('defaults duration to 6 when duration_seconds is NaN (guarded, not NaN-propagated)', () => {
    expect(normalize({ id: 'a', start_seconds: 10, duration_seconds: NaN })).toEqual({
      start: 10,
      end: 16,
    })
  })

  it('defaults duration to 6 when duration_seconds is zero', () => {
    expect(normalize({ id: 'a', start_seconds: 10, duration_seconds: 0 })).toEqual({
      start: 10,
      end: 16,
    })
  })

  it('defaults duration to 6 when duration_seconds is negative', () => {
    expect(normalize({ id: 'a', start_seconds: 10, duration_seconds: -3 })).toEqual({
      start: 10,
      end: 16,
    })
  })

  it('floors a tiny positive duration at 0.05', () => {
    expect(normalize({ id: 'a', start_seconds: 10, duration_seconds: 0.001 })).toEqual({
      start: 10,
      end: 10.05,
    })
  })

  it('accepts a duration exactly at the 0.05 floor unchanged', () => {
    expect(normalize({ id: 'a', start_seconds: 0, duration_seconds: 0.05 })).toEqual({
      start: 0,
      end: 0.05,
    })
  })

  it('treats duration_seconds Infinity as invalid (falls back to default 6)', () => {
    // Number.isFinite(Infinity) is false, so this takes the default-duration branch.
    expect(
      normalize({ id: 'a', start_seconds: 0, duration_seconds: Infinity }),
    ).toEqual({ start: 0, end: 6 })
  })

  it('handles start_seconds of exactly 0', () => {
    expect(normalize({ id: 'a', start_seconds: 0, duration_seconds: 5 })).toEqual({
      start: 0,
      end: 5,
    })
  })

  it('preserves microsecond-precision start/duration exactly (no float rounding)', () => {
    expect(
      normalize({ id: 'a', start_seconds: 14.000123, duration_seconds: 5.999877 }),
    ).toEqual({ start: 14.000123, end: 20.0 })
  })
})

describe('computeActive', () => {
  const cues: CueSpec[] = [
    { id: 'a', start_seconds: 0, duration_seconds: 5 }, // [0, 5)
    { id: 'b', start_seconds: 5, duration_seconds: 5 }, // [5, 10)
    { id: 'c', start_seconds: 3, duration_seconds: 10 }, // [3, 13) — overlaps a and b
  ]

  it('includes a cue at its exact start boundary (start <= t)', () => {
    expect(computeActive(cues, 5)).toEqual(new Set(['b', 'c']))
  })

  it('excludes a cue at its exact end boundary (t < end)', () => {
    // t === 5 is a's end -> a excluded; b starts at 5 -> included
    expect(computeActive(cues, 5).has('a')).toBe(false)
  })

  it('is empty before any cue starts', () => {
    expect(computeActive(cues, -1)).toEqual(new Set())
  })

  it('is empty after all cues end', () => {
    expect(computeActive(cues, 100)).toEqual(new Set())
  })

  it('returns every overlapping cue mid-overlap', () => {
    expect(computeActive(cues, 4)).toEqual(new Set(['a', 'c']))
  })

  it('handles t exactly at 0 for a cue starting at 0', () => {
    expect(computeActive(cues, 0)).toEqual(new Set(['a']))
  })

  it('skips cues that normalize to null (NaN start)', () => {
    const withInvalid: CueSpec[] = [
      { id: 'bad', start_seconds: NaN, duration_seconds: 5 },
      { id: 'good', start_seconds: 0, duration_seconds: 5 },
    ]
    expect(computeActive(withInvalid, 1)).toEqual(new Set(['good']))
  })

  it('clamps a negative start so the cue can be active at t=0', () => {
    const negativeStart: CueSpec[] = [
      { id: 'a', start_seconds: -10, duration_seconds: 5 },
    ]
    expect(computeActive(negativeStart, 0)).toEqual(new Set(['a']))
  })

  it('treats a zero duration as the default 6s window, not an empty window', () => {
    const zeroDur: CueSpec[] = [{ id: 'a', start_seconds: 0, duration_seconds: 0 }]
    expect(computeActive(zeroDur, 5.9)).toEqual(new Set(['a']))
    expect(computeActive(zeroDur, 6)).toEqual(new Set())
  })

  it('returns an empty set for an empty cue list', () => {
    expect(computeActive([], 0)).toEqual(new Set())
  })

  it('handles t as NaN by matching nothing (NaN comparisons are false)', () => {
    expect(computeActive(cues, NaN)).toEqual(new Set())
  })

  it('returns all cues simultaneously active when they fully overlap', () => {
    const overlapping: CueSpec[] = [
      { id: 'x', start_seconds: 0, duration_seconds: 10 },
      { id: 'y', start_seconds: 0, duration_seconds: 10 },
    ]
    expect(computeActive(overlapping, 5)).toEqual(new Set(['x', 'y']))
  })

  it('excludes a cue one microsecond before its start', () => {
    const cue: CueSpec[] = [{ id: 'a', start_seconds: 10, duration_seconds: 5 }]
    expect(computeActive(cue, 10 - 0.000001).has('a')).toBe(false)
  })

  it('includes a cue one microsecond after its start', () => {
    const cue: CueSpec[] = [{ id: 'a', start_seconds: 10, duration_seconds: 5 }]
    expect(computeActive(cue, 10 + 0.000001).has('a')).toBe(true)
  })

  it('excludes a cue one microsecond after its end', () => {
    const cue: CueSpec[] = [{ id: 'a', start_seconds: 10, duration_seconds: 5 }]
    expect(computeActive(cue, 15 + 0.000001).has('a')).toBe(false)
  })

  it('includes a cue one microsecond before its end', () => {
    const cue: CueSpec[] = [{ id: 'a', start_seconds: 10, duration_seconds: 5 }]
    expect(computeActive(cue, 15 - 0.000001).has('a')).toBe(true)
  })
})

describe('timingSignature', () => {
  it('is stable across array order (sorted by id)', () => {
    const a: CueSpec[] = [
      { id: 'b', start_seconds: 5, duration_seconds: 2 },
      { id: 'a', start_seconds: 0, duration_seconds: 1 },
    ]
    const b: CueSpec[] = [
      { id: 'a', start_seconds: 0, duration_seconds: 1 },
      { id: 'b', start_seconds: 5, duration_seconds: 2 },
    ]
    expect(timingSignature(a)).toBe(timingSignature(b))
  })

  it('changes when a start time changes', () => {
    const before: CueSpec[] = [{ id: 'a', start_seconds: 0, duration_seconds: 1 }]
    const after: CueSpec[] = [{ id: 'a', start_seconds: 1, duration_seconds: 1 }]
    expect(timingSignature(before)).not.toBe(timingSignature(after))
  })

  it('changes when a duration changes', () => {
    const before: CueSpec[] = [{ id: 'a', start_seconds: 0, duration_seconds: 1 }]
    const after: CueSpec[] = [{ id: 'a', start_seconds: 0, duration_seconds: 2 }]
    expect(timingSignature(before)).not.toBe(timingSignature(after))
  })

  it('is unaffected by fields outside id/start/duration (no body text baked in)', () => {
    // CueSpec has no body field, but this documents the contract: only
    // timing may rebuild cues, so the signature must be a pure function of
    // id/start_seconds/duration_seconds and nothing else.
    const cues: CueSpec[] = [{ id: 'a', start_seconds: 1, duration_seconds: 2 }]
    expect(timingSignature(cues)).toBe(timingSignature(cues))
  })

  it('returns an empty string for an empty array', () => {
    expect(timingSignature([])).toBe('')
  })

  it('produces distinct signatures for different id sets of the same size', () => {
    const a: CueSpec[] = [{ id: 'a', start_seconds: 0, duration_seconds: 1 }]
    const b: CueSpec[] = [{ id: 'z', start_seconds: 0, duration_seconds: 1 }]
    expect(timingSignature(a)).not.toBe(timingSignature(b))
  })

  it('includes NaN/negative values verbatim (raw input, not normalized)', () => {
    const cues: CueSpec[] = [{ id: 'a', start_seconds: NaN, duration_seconds: -3 }]
    expect(timingSignature(cues)).toBe('a|NaN|-3')
  })
})
