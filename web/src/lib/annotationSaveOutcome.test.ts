import { describe, expect, it } from 'vitest'
import { isDefinitiveAnnotationFailure } from './annotationSaveOutcome'

describe('annotation save certainty', () => {
  it.each([
    { label: 'access rejection', error: { status: 403 }, initial: true, retry: false },
    { label: 'ordinary conflict', error: { status: 409 }, initial: true, retry: false },
    { label: 'validation rejection', error: { status: 422 }, initial: true, retry: false },
    { label: 'rate limit', error: { status: 429 }, initial: true, retry: false },
    { label: 'busy rollback', error: { status: 503, data: { code: 'annotation_busy' } }, initial: true, retry: false },
    { label: 'overlap rollback', error: { status: 422, data: { code: 'annotation_overlap' } }, initial: true, retry: true },
    { label: 'server failure', error: { status: 500 }, initial: false, retry: false },
    { label: 'unknown service failure', error: { status: 503 }, initial: false, retry: false },
    { label: 'network failure', error: { status: 'FETCH_ERROR' }, initial: false, retry: false },
    { label: 'mismatched acknowledgement', error: { status: 'ACK_MISMATCH' }, initial: false, retry: false },
    { label: 'string status is not overlap proof', error: { status: '422', data: { code: 'annotation_overlap' } }, initial: false, retry: false },
    { label: 'missing failure envelope', error: null, initial: false, retry: false },
  ])('$label preserves initial versus unresolved-retry semantics', ({ error, initial, retry }) => {
    expect(isDefinitiveAnnotationFailure(error, false)).toBe(initial)
    expect(isDefinitiveAnnotationFailure(error, true)).toBe(retry)
  })
})
