import { describe, expect, it } from 'vitest'
import { annotationGeometry, captureAnnotationTime, formatAnnotationTime, geometriesOverlap, parseAnnotationTime, validateAnnotationSelection, type TimingAnnotation } from './annotationTiming'

describe('explicit annotation timecodes', () => {
  it.each([
    ['0', 0], ['12.5', 12500], ['0:12.500', 12500], ['1:02:03.250', 3723250],
    [' 1:00.001 ', 60001], ['120:00', 7200000], ['9999999.999', 9999999999],
  ])('parses %s as exact milliseconds', (text, milliseconds) => {
    expect(parseAnnotationTime(text)).toBe(milliseconds)
    expect(parseAnnotationTime(formatAnnotationTime(milliseconds))).toBe(milliseconds)
  })
  it.each(['', ' ', '-1', '+1', '1e2', '.5', '1.', '1:60', '1:2', '1::02', '1:60:00', '1:02.0001', '1:02:03:04', '1 :02', '12ms', 'Infinity', '10000000'])('rejects invalid input %s', (text) => {
    expect(parseAnnotationTime(text)).toBeNull()
  })
  it('captures positions without silently clamping out-of-bound times', () => {
    expect(captureAnnotationTime(12.5005, 20000)).toBe(12501)
    expect(captureAnnotationTime(20.001, 20000)).toBeNull()
    expect(captureAnnotationTime(19.999999, 20000, true)).toBe(20000)
    expect(captureAnnotationTime(1, null)).toBeNull()
    expect(captureAnnotationTime(NaN, 20000)).toBeNull()
  })
})

const note: TimingAnnotation = { id: 'saved', timing_type: 'range', start_seconds: 10, duration_seconds: 5, voice: null }
const point: TimingAnnotation = { ...note, id: 'point', timing_type: 'point', start_seconds: 20, duration_seconds: 90 }
const selection = (overrides: Partial<Parameters<typeof validateAnnotationSelection>[0]> = {}) => validateAnnotationSelection({
  start: '0:15.000', end: '0:20.000', body: 'Specific feedback', durationMs: 200000, annotations: [note, point], ...overrides,
})

describe('authoring geometry', () => {
  it('allows adjacent ranges ending exactly at a point and rejects a point at start', () => {
    expect(selection().valid).toBe(true)
    expect(selection({ start: '0:20.000', end: '0:21.000' }).conflicts.map((row) => row.id)).toEqual(['point'])
    expect(selection({ start: '0:14.999' }).conflicts.map((row) => row.id)).toEqual(['saved'])
  })
  it('retains an erased voice as a point regardless of its recording length', () => {
    expect(annotationGeometry(point)).toEqual({ type: 'point', startMs: 20000, endMs: 20000 })
    expect(selection({ start: '20.001', end: '25' }).valid).toBe(true)
  })
  it('blocks duplicate points symmetrically without using recording duration', () => {
    const geometry = annotationGeometry(point)!
    expect(geometriesOverlap(geometry, geometry)).toBe(true)
    expect(geometriesOverlap(geometry, { type: 'point', startMs: 20001, endMs: 20001 })).toBe(false)
    expect(geometriesOverlap({ type: 'range', startMs: 0, endMs: 20000 }, geometry)).toBe(false)
  })
  it('excludes only the row being edited', () => {
    expect(selection({ start: '10', end: '15', excludeId: 'saved' }).valid).toBe(true)
    expect(selection({ start: '10', end: '15' }).valid).toBe(false)
  })
  it.each([
    [{ start: '', end: '' }, 'start'], [{ end: '15.499' }, 'end'], [{ end: '200.001' }, 'end'],
    [{ end: '136' }, 'end'], [{ body: ' ' }, 'body'], [{ durationMs: null }, 'general'],
    [{ annotations: undefined }, 'general'],
  ] as const)('explains incomplete or invalid selections %j', (overrides, field) => {
    const result = selection(overrides)
    expect(result.valid).toBe(false)
    expect(result.errors[field]).toBeTruthy()
  })
  it('fails closed for unreadable existing timing and reserves unresolved legacy spans', () => {
    expect(selection({ annotations: [{ ...note, start_seconds: NaN }] }).errors.general).toContain('Refresh')
    expect(selection({ annotations: [{ ...point, timing_type: null }] }).valid).toBe(true)
    expect(selection({ start: '21', end: '22', annotations: [{ ...point, timing_type: null }] }).valid).toBe(false)
  })
})
