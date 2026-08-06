import { describe, expect, it } from 'vitest'
import { computeActive, normalize, timingSignature, type CueSpec } from './engine'

describe('normalize', () => {
  it('returns start/end for a normal cue', () => {
    expect(normalize({ id: 'a', startSeconds: 10, durationSeconds: 5 })).toEqual({
      start: 10,
      end: 15,
    })
  })

  it('clamps a negative start to 0', () => {
    expect(normalize({ id: 'a', startSeconds: -5, durationSeconds: 5 })).toEqual({
      start: 0,
      end: 5,
    })
  })

  it('returns null when startSeconds is NaN', () => {
    expect(normalize({ id: 'a', startSeconds: NaN, durationSeconds: 5 })).toBeNull()
  })

  it('returns null when startSeconds is +Infinity', () => {
    expect(
      normalize({ id: 'a', startSeconds: Infinity, durationSeconds: 5 }),
    ).toBeNull()
  })

  it('returns null when startSeconds is -Infinity', () => {
    expect(
      normalize({ id: 'a', startSeconds: -Infinity, durationSeconds: 5 }),
    ).toBeNull()
  })

  it('defaults duration to 6 when durationSeconds is NaN (guarded, not NaN-propagated)', () => {
    expect(normalize({ id: 'a', startSeconds: 10, durationSeconds: NaN })).toEqual({
      start: 10,
      end: 16,
    })
  })

  it('defaults duration to 6 when durationSeconds is zero', () => {
    expect(normalize({ id: 'a', startSeconds: 10, durationSeconds: 0 })).toEqual({
      start: 10,
      end: 16,
    })
  })

  it('defaults duration to 6 when durationSeconds is negative', () => {
    expect(normalize({ id: 'a', startSeconds: 10, durationSeconds: -3 })).toEqual({
      start: 10,
      end: 16,
    })
  })

  it('floors a tiny positive duration at 0.05', () => {
    expect(normalize({ id: 'a', startSeconds: 10, durationSeconds: 0.001 })).toEqual({
      start: 10,
      end: 10.05,
    })
  })

  it('accepts a duration exactly at the 0.05 floor unchanged', () => {
    expect(normalize({ id: 'a', startSeconds: 0, durationSeconds: 0.05 })).toEqual({
      start: 0,
      end: 0.05,
    })
  })

  it('treats durationSeconds Infinity as invalid (falls back to default 6)', () => {
    // Number.isFinite(Infinity) is false, so this takes the default-duration branch.
    expect(
      normalize({ id: 'a', startSeconds: 0, durationSeconds: Infinity }),
    ).toEqual({ start: 0, end: 6 })
  })

  it('handles startSeconds of exactly 0', () => {
    expect(normalize({ id: 'a', startSeconds: 0, durationSeconds: 5 })).toEqual({
      start: 0,
      end: 5,
    })
  })
})

describe('computeActive', () => {
  const cues: CueSpec[] = [
    { id: 'a', startSeconds: 0, durationSeconds: 5 }, // [0, 5)
    { id: 'b', startSeconds: 5, durationSeconds: 5 }, // [5, 10)
    { id: 'c', startSeconds: 3, durationSeconds: 10 }, // [3, 13) — overlaps a and b
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
      { id: 'bad', startSeconds: NaN, durationSeconds: 5 },
      { id: 'good', startSeconds: 0, durationSeconds: 5 },
    ]
    expect(computeActive(withInvalid, 1)).toEqual(new Set(['good']))
  })

  it('clamps a negative start so the cue can be active at t=0', () => {
    const negativeStart: CueSpec[] = [
      { id: 'a', startSeconds: -10, durationSeconds: 5 },
    ]
    expect(computeActive(negativeStart, 0)).toEqual(new Set(['a']))
  })

  it('treats a zero duration as the default 6s window, not an empty window', () => {
    const zeroDur: CueSpec[] = [{ id: 'a', startSeconds: 0, durationSeconds: 0 }]
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
      { id: 'x', startSeconds: 0, durationSeconds: 10 },
      { id: 'y', startSeconds: 0, durationSeconds: 10 },
    ]
    expect(computeActive(overlapping, 5)).toEqual(new Set(['x', 'y']))
  })
})

describe('timingSignature', () => {
  it('is stable across array order (sorted by id)', () => {
    const a: CueSpec[] = [
      { id: 'b', startSeconds: 5, durationSeconds: 2 },
      { id: 'a', startSeconds: 0, durationSeconds: 1 },
    ]
    const b: CueSpec[] = [
      { id: 'a', startSeconds: 0, durationSeconds: 1 },
      { id: 'b', startSeconds: 5, durationSeconds: 2 },
    ]
    expect(timingSignature(a)).toBe(timingSignature(b))
  })

  it('changes when a start time changes', () => {
    const before: CueSpec[] = [{ id: 'a', startSeconds: 0, durationSeconds: 1 }]
    const after: CueSpec[] = [{ id: 'a', startSeconds: 1, durationSeconds: 1 }]
    expect(timingSignature(before)).not.toBe(timingSignature(after))
  })

  it('changes when a duration changes', () => {
    const before: CueSpec[] = [{ id: 'a', startSeconds: 0, durationSeconds: 1 }]
    const after: CueSpec[] = [{ id: 'a', startSeconds: 0, durationSeconds: 2 }]
    expect(timingSignature(before)).not.toBe(timingSignature(after))
  })

  it('is unaffected by fields outside id/start/duration (no body text baked in)', () => {
    // CueSpec has no body field, but this documents the contract: only
    // timing may rebuild cues, so the signature must be a pure function of
    // id/startSeconds/durationSeconds and nothing else.
    const cues: CueSpec[] = [{ id: 'a', startSeconds: 1, durationSeconds: 2 }]
    expect(timingSignature(cues)).toBe(timingSignature(cues))
  })

  it('returns an empty string for an empty array', () => {
    expect(timingSignature([])).toBe('')
  })

  it('produces distinct signatures for different id sets of the same size', () => {
    const a: CueSpec[] = [{ id: 'a', startSeconds: 0, durationSeconds: 1 }]
    const b: CueSpec[] = [{ id: 'z', startSeconds: 0, durationSeconds: 1 }]
    expect(timingSignature(a)).not.toBe(timingSignature(b))
  })

  it('includes NaN/negative values verbatim (raw input, not normalized)', () => {
    const cues: CueSpec[] = [{ id: 'a', startSeconds: NaN, durationSeconds: -3 }]
    expect(timingSignature(cues)).toBe('a|NaN|-3')
  })
})
