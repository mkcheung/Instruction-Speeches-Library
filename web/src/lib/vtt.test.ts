import { describe, expect, it } from 'vitest'
import { formatVttTimestamp, parseVtt, serializeVtt } from '@/lib/vtt'

const SAMPLE = `WEBVTT

1
00:00:01.000 --> 00:00:04.500
Hello world

2
00:00:05.250 --> 00:00:07.000
Second line of text`

describe('formatVttTimestamp', () => {
  it('formats sub-hour durations with a zero hours segment', () => {
    expect(formatVttTimestamp(65.5)).toBe('00:01:05.500')
  })

  it('formats hour-scale durations', () => {
    expect(formatVttTimestamp(3661.25)).toBe('01:01:01.250')
  })

  it('clamps negative/non-finite input to zero', () => {
    expect(formatVttTimestamp(-5)).toBe('00:00:00.000')
    expect(formatVttTimestamp(NaN)).toBe('00:00:00.000')
  })
})

describe('parseVtt', () => {
  it('parses cue id, timing, and text out of a WebVTT document', () => {
    const cues = parseVtt(SAMPLE)
    expect(cues).toEqual([
      { id: '1', start: 1, end: 4.5, text: 'Hello world' },
      { id: '2', start: 5.25, end: 7, text: 'Second line of text' },
    ])
  })

  it('synthesizes an id for a cue with no explicit id line', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nNo id here')
    expect(cues).toEqual([{ id: 'cue-0', start: 0, end: 1, text: 'No id here' }])
  })

  it('returns an empty list for blank input', () => {
    expect(parseVtt('')).toEqual([])
    expect(parseVtt('   ')).toEqual([])
  })

  it('skips NOTE blocks', () => {
    const withNote = 'WEBVTT\n\nNOTE this is a comment\n\n00:00:00.000 --> 00:00:01.000\nReal cue'
    expect(parseVtt(withNote)).toEqual([{ id: 'cue-0', start: 0, end: 1, text: 'Real cue' }])
  })

  it('preserves multi-line cue text', () => {
    const multiline = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nLine one\nLine two'
    expect(parseVtt(multiline)[0].text).toBe('Line one\nLine two')
  })
})

describe('serializeVtt', () => {
  it('round-trips through parseVtt', () => {
    const cues = parseVtt(SAMPLE)
    const reparsed = parseVtt(serializeVtt(cues))
    expect(reparsed).toEqual(cues)
  })

  it('sorts cues by start time regardless of input order', () => {
    const vtt = serializeVtt([
      { id: 'b', start: 5, end: 6, text: 'second' },
      { id: 'a', start: 1, end: 2, text: 'first' },
    ])
    const cues = parseVtt(vtt)
    expect(cues.map((c) => c.text)).toEqual(['first', 'second'])
  })

  it('produces a bare header for an empty cue list', () => {
    expect(serializeVtt([])).toBe('WEBVTT\n')
  })
})
