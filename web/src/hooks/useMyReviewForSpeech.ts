import { useListMyReviewsQuery } from '@/features/review/reviewApi'
import type { Review } from '@/features/review/types'

/** `Review::ACCESS_GRANTING` (`api/app/Models/Review.php`) — mirrored here
 * rather than re-fetched, since the frontend has no endpoint that returns
 * the constant itself and it's stable across this codebase's steps. */
const ACCESS_GRANTING = new Set(['accepted', 'in_progress', 'published'])

/**
 * Finds the CALLER's own review for a given speech, across all four
 * dashboard sections `GET /api/reviews` already returns in one payload
 * (`listMyReviews`) — no new endpoint needed for the composer to find
 * "which review am I authoring." Used to gate STEP-07's
 * `AnnotationComposerPanel`: it renders only for a viewer who is
 * themselves an access-granting reviewer of this speech, never the owner
 * (who gets `TrackSelector`/STEP-06's read-only view instead).
 */
export function useMyReviewForSpeech(
  speechId: number,
  enabled: boolean,
): { review: Review | null; isLoading: boolean } {
  const { data, isLoading } = useListMyReviewsQuery(undefined, { skip: !enabled })

  if (!data) return { review: null, isLoading }

  const all = [
    ...(data.invited ?? []),
    ...(data.in_progress ?? []),
    ...(data.published ?? []),
    ...(data.revoked ?? []),
  ]
  const mine =
    all.find((r) => r.speech?.id === speechId && r.revoked_at === null && ACCESS_GRANTING.has(r.status)) ?? null

  return { review: mine, isLoading }
}
