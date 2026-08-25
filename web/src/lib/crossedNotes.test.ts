import { describe, expect, it } from 'vitest'
import { crossedNotes } from '@/lib/crossedNotes'

const note = (id: string, start_seconds: number) => ({ id, start_seconds })

describe('crossedNotes', () => {
  it('returns a note crossed during ordinary forward playback', () => {
    expect(crossedNotes([note('a', 2)], 1.8, 2.1, true).map((n) => n.id)).toEqual(['a'])
  })

  it('uses an open lower and closed upper boundary', () => {
    expect(crossedNotes([note('at-prev', 2), note('at-now', 2.25)], 2, 2.25, true).map((n) => n.id)).toEqual([
      'at-now',
    ])
  })

  it('does not fire while paused, moving backwards, or jumping forward', () => {
    const notes = [note('a', 2)]
    expect(crossedNotes(notes, 2, 2, true)).toEqual([])
    expect(crossedNotes(notes, 3, 1, true)).toEqual([])
    expect(crossedNotes(notes, 0, 2, true)).toEqual([])
  })

  it('treats a jump of exactly the seek epsilon as ordinary playback', () => {
    expect(crossedNotes([note('edge', 1)], 0, 1, true).map((n) => n.id)).toEqual(['edge'])
  })

  it('returns nothing for an empty list or non-finite clock values', () => {
    expect(crossedNotes([], 0, 0.25, true)).toEqual([])
    expect(crossedNotes([note('a', 1)], Number.NaN, 1, true)).toEqual([])
    expect(crossedNotes([note('a', 1)], 0, Number.POSITIVE_INFINITY, true)).toEqual([])
  })

  it('includes a note at exactly zero on the first advancing tick', () => {
    expect(crossedNotes([note('zero', 0)], 0, 0.2, false).map((n) => n.id)).toEqual(['zero'])
  })

  it('does not include zero again after playback has started', () => {
    expect(crossedNotes([note('zero', 0)], 0, 0.2, true)).toEqual([])
  })

  it('returns every note crossed in one tick in deterministic playback order', () => {
    expect(
      crossedNotes([note('c', 2.2), note('b', 2.1), note('a', 2.1)], 2, 2.25, true).map((n) => n.id),
    ).toEqual(['a', 'b', 'c'])
  })

  it('naturally re-arms after a backward seek', () => {
    const notes = [note('a', 5)]
    expect(crossedNotes(notes, 4.8, 5.1, true)).toHaveLength(1)
    expect(crossedNotes(notes, 5.1, 3, true)).toEqual([])
    expect(crossedNotes(notes, 4.9, 5.1, true)).toHaveLength(1)
  })
})
