/** Account-scoped, revisioned recovery. Legacy mirrors are deliberately untouched. */
export interface AnnotationDraftFields { start: string; end: string; body: string }
export interface AnnotationSubmission {
  clientUuid: string
  annotationId: string | null
  lockVersion: number
  fields: AnnotationDraftFields
  startMs: number
  endMs: number
  timingChanged: boolean
}
export interface AnnotationDraftScope { userId: string; speechId: number; reviewId: number; rowId: string | null }
export interface AnnotationRecoveryRecord {
  version: 2
  scope: AnnotationDraftScope
  instanceId: string
  clientUuid: string
  revision: number
  updatedAt: number
  fields: AnnotationDraftFields
  lockVersion: number
  uncertain: AnnotationSubmission | null
}

function prefix(scope: AnnotationDraftScope): string {
  return `annotation-recovery:v2:${encodeURIComponent(scope.userId)}:${scope.speechId}:${scope.reviewId}:${scope.rowId ?? 'new'}:`
}
export function annotationRecoveryKey(record: AnnotationRecoveryRecord): string {
  return `${prefix(record.scope)}${record.clientUuid}:${record.instanceId}`
}
function validFields(value: unknown): value is AnnotationDraftFields {
  if (!value || typeof value !== 'object') return false
  const fields = value as AnnotationDraftFields
  return typeof fields.start === 'string' && typeof fields.end === 'string' && typeof fields.body === 'string'
}
function validRecord(value: unknown, scope: AnnotationDraftScope): value is AnnotationRecoveryRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as AnnotationRecoveryRecord
  if (record.version !== 2 || !record.scope || record.scope.userId !== scope.userId || record.scope.speechId !== scope.speechId
    || record.scope.reviewId !== scope.reviewId || record.scope.rowId !== scope.rowId
    || typeof record.instanceId !== 'string' || typeof record.clientUuid !== 'string'
    || !/^[a-zA-Z0-9-]+$/.test(record.instanceId) || !/^[a-zA-Z0-9-]+$/.test(record.clientUuid)
    || !Number.isSafeInteger(record.revision) || record.revision < 0 || !Number.isFinite(record.updatedAt)
    || !Number.isSafeInteger(record.lockVersion) || record.lockVersion < 0 || !validFields(record.fields)) return false
  const submission = record.uncertain
  return submission === null || (typeof submission === 'object' && submission.clientUuid === record.clientUuid
    && submission.annotationId === scope.rowId && Number.isSafeInteger(submission.lockVersion) && submission.lockVersion >= 0
    && validFields(submission.fields) && JSON.stringify(submission.fields) === JSON.stringify(record.fields)
    && Number.isSafeInteger(submission.startMs) && Number.isSafeInteger(submission.endMs)
    && submission.startMs >= 0 && submission.endMs > submission.startMs && typeof submission.timingChanged === 'boolean')
}

export function writeAnnotationRecovery(record: AnnotationRecoveryRecord): boolean {
  try {
    localStorage.setItem(annotationRecoveryKey(record), JSON.stringify(record))
    return true
  } catch { return false }
}

/** Prefix discovery is the context index: concurrent tabs cannot overwrite it. */
export function discoverAnnotationRecovery(scope: AnnotationDraftScope): AnnotationRecoveryRecord[] {
  const records: AnnotationRecoveryRecord[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix(scope))) continue
      try {
        const record: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (validRecord(record, scope) && annotationRecoveryKey(record) === key) records.push(record)
      } catch { /* A malformed entry must not hide the remaining drafts. */ }
    }
  } catch { /* Unavailable storage leaves the in-memory editor intact. */ }
  return records.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Also makes drafts discoverable after another tab removes their saved row. */
export function discoverAnnotationReviewRecovery(scope: Omit<AnnotationDraftScope, 'rowId'>): AnnotationRecoveryRecord[] {
  const records: AnnotationRecoveryRecord[] = []
  const reviewPrefix = prefix({ ...scope, rowId: null }).slice(0, -'new:'.length)
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(reviewPrefix)) continue
      try {
        const record = JSON.parse(localStorage.getItem(key) ?? 'null') as AnnotationRecoveryRecord | null
        if (!record?.scope || record.scope.userId !== scope.userId || record.scope.speechId !== scope.speechId
          || record.scope.reviewId !== scope.reviewId || (record.scope.rowId !== null && typeof record.scope.rowId !== 'string')) continue
        if (validRecord(record, record.scope) && annotationRecoveryKey(record) === key) records.push(record)
      } catch { /* A corrupt record must not hide valid drafts. */ }
    }
  } catch { /* Keep in-memory editing available. */ }
  return records.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Clear only the exact revision the caller acknowledged or explicitly discarded. */
export function clearAnnotationRecovery(record: AnnotationRecoveryRecord): boolean {
  try {
    const key = annotationRecoveryKey(record)
    const current = localStorage.getItem(key)
    if (current !== JSON.stringify(record)) return false
    localStorage.removeItem(key)
    return true
  } catch { return false }
}
