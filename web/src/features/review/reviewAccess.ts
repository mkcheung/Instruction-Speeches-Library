import type { Review, ReviewStatus } from './types'

/** Mirrors Review::ACCESS_GRANTING. Identity, revocation and permission checks stay with callers. */
const ACCESS_GRANTING: ReadonlySet<ReviewStatus> = new Set(['accepted', 'in_progress', 'published'])

export function isAccessGrantingReviewStatus(status: ReviewStatus): boolean {
  return ACCESS_GRANTING.has(status)
}

/** A review that is not revoked and grants access to `speechId`. */
export function grantsSpeechAccess(review: Review | null | undefined, speechId: number): review is Review {
  return review?.speech?.id === speechId && review.revoked_at === null && isAccessGrantingReviewStatus(review.status)
}
