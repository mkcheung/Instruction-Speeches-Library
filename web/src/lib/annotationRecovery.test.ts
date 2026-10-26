import { beforeEach, describe, expect, it, vi } from 'vitest'
import { annotationRecoveryKey, clearAnnotationRecovery, discoverAnnotationRecovery, discoverAnnotationReviewRecovery, writeAnnotationRecovery, type AnnotationRecoveryRecord } from './annotationRecovery'
const scope = { userId: 'coach', speechId: 8, reviewId: 3, rowId: null }
function record(overrides: Partial<AnnotationRecoveryRecord> = {}): AnnotationRecoveryRecord {
  return { version: 2, scope, instanceId: 'tab-a', clientUuid: 'draft-a', revision: 1, updatedAt: 1,
    fields: { start: '12.5', end: '18', body: 'Recover this' }, lockVersion: 0, uncertain: null, ...overrides }
}
describe('scoped annotation recovery', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
  it('discovers each tab/draft independently and never reads a different account or review', () => {
    writeAnnotationRecovery(record()); writeAnnotationRecovery(record({ instanceId: 'tab-b', updatedAt: 2 }))
    writeAnnotationRecovery(record({ clientUuid: 'another-draft' }))
    expect(discoverAnnotationRecovery(scope)).toHaveLength(3)
    expect(discoverAnnotationRecovery({ ...scope, userId: 'another-account' })).toHaveLength(0)
    expect(discoverAnnotationRecovery({ ...scope, reviewId: 4 })).toHaveLength(0)
  })
  it('acknowledging an older revision cannot remove newer text or another tab', () => {
    const older = record(); writeAnnotationRecovery(older)
    writeAnnotationRecovery(record({ revision: 2, fields: { ...older.fields, body: 'Newer text' } }))
    const sibling = record({ instanceId: 'tab-b' }); writeAnnotationRecovery(sibling)
    expect(clearAnnotationRecovery(older)).toBe(false)
    expect(clearAnnotationRecovery(sibling)).toBe(true)
    expect(discoverAnnotationRecovery(scope)).toHaveLength(1)
    expect(discoverAnnotationRecovery(scope)[0].fields.body).toBe('Newer text')
  })

  it('keeps row drafts discoverable even after their original row is removed', () => {
    writeAnnotationRecovery(record({ scope: { ...scope, rowId: '9' } }))
    writeAnnotationRecovery(record({ scope: { ...scope, userId: 'other', rowId: '9' } }))
    expect(discoverAnnotationRecovery(scope)).toHaveLength(0)
    expect(discoverAnnotationReviewRecovery(scope)).toHaveLength(1)
    expect(discoverAnnotationReviewRecovery(scope)[0].scope.rowId).toBe('9')
  })
  it('rejects corrupt or mismatched envelopes without hiding other recoverable records', () => {
    writeAnnotationRecovery(record())
    localStorage.setItem(annotationRecoveryKey(record({ instanceId: 'corrupt' })), '{broken')
    const wrong = record({ instanceId: 'wrong' }); localStorage.setItem(annotationRecoveryKey(wrong), JSON.stringify({ ...wrong, scope: { ...scope, userId: 'other' } }))
    expect(discoverAnnotationRecovery(scope)).toHaveLength(1)
  })
  it('keeps row and whole-review discovery scoped while sorting valid drafts around corrupt entries', () => {
    const latest = record({ instanceId: 'latest', updatedAt: 8 })
    const rowDraft = record({ instanceId: 'saved-row', scope: { ...scope, rowId: '9' }, updatedAt: 5 })
    for (const item of [record(), latest, rowDraft]) writeAnnotationRecovery(item)
    const badKey = annotationRecoveryKey(record({ instanceId: 'bad' }))
    localStorage.setItem(badKey, 'null')
    localStorage.setItem(badKey + '-json', '{broken')
    localStorage.setItem(badKey + '-foreign', JSON.stringify(record({ scope: { ...scope, reviewId: 99 } })))
    localStorage.setItem(badKey + '-noncanonical', JSON.stringify(record({ instanceId: 'different' })))
    const invalidRow = { ...record(), scope: { ...scope, rowId: 9 } }
    localStorage.setItem(badKey + '-row', JSON.stringify(invalidRow))
    expect(discoverAnnotationRecovery(scope).map((item) => item.instanceId)).toEqual(['latest', 'tab-a'])
    expect(discoverAnnotationReviewRecovery(scope).map((item) => item.instanceId)).toEqual(['latest', 'saved-row', 'tab-a'])
    expect(discoverAnnotationReviewRecovery({ ...scope, userId: 'another-account' })).toEqual([])
    expect(localStorage.getItem(badKey)).toBe('null')
  })
  it('keeps original uncertain submission identity and does not touch legacy mirrors', () => {
    const fields = record().fields
    const uncertain = record({ uncertain: { fields, clientUuid: 'draft-a', annotationId: null, lockVersion: 0, startMs: 12500, endMs: 18000, timingChanged: true } })
    localStorage.setItem('annotation-draft:legacy', 'keep')
    writeAnnotationRecovery(uncertain)
    expect(discoverAnnotationRecovery(scope)[0].uncertain).toEqual(uncertain.uncertain)
    expect(localStorage.getItem('annotation-draft:legacy')).toBe('keep')
  })
  it('reports unavailable storage without throwing or promising recovery', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    expect(writeAnnotationRecovery(record())).toBe(false)
  })
  it('keeps both discovery paths available when storage cannot be enumerated', () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    writeAnnotationRecovery(record())
    expect(discoverAnnotationRecovery(scope)).toEqual([])
    expect(discoverAnnotationReviewRecovery(scope)).toEqual([])
  })
})
