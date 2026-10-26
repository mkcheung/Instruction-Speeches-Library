import type { ReviewStatus } from './types'

/** Mirrors Review::ACCESS_GRANTING. Identity, revocation and permission checks stay with callers. */
const ACCESS_GRANTING: ReadonlySet<ReviewStatus> = new Set(['accepted', 'in_progress', 'published'])

export function isAccessGrantingReviewStatus(status: ReviewStatus): boolean {
  return ACCESS_GRANTING.has(status)
}
