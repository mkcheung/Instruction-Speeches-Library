/**
 * IMPLEMENTATION-PLANS.md §7.4: "new since you last looked" for the
 * speaker's commentary chips — no backend needed, mirrors
 * `annotationDraftStorage.ts`'s try/catch-around-every-call shape (private
 * mode, quota, disabled storage must never throw into render).
 *
 * Keyed on `(speechId, reviewId)`, storing the `last_published_at` value
 * that was current the last time the speaker viewed that track — not a
 * boolean. A reviewer can publish again after the speaker has already seen
 * their first round, and the stored timestamp is what lets a later publish
 * re-trigger the unread dot rather than staying permanently "seen" the
 * first time the chip is ever clicked.
 */
function seenKey(speechId: number, reviewId: number): string {
  return `commentary-seen:${speechId}:${reviewId}`
}

export function markCommentarySeen(speechId: number, reviewId: number, lastPublishedAt: string): void {
  try {
    localStorage.setItem(seenKey(speechId, reviewId), lastPublishedAt)
  } catch {
    // Storage unavailable — the unread dot is a nicety, not load-bearing.
  }
}

/** `lastPublishedAt` is the review's current `last_published_at` off the
 * wire; `null` (nothing published yet) is never unread — there is nothing
 * to have missed. */
export function hasUnseenCommentary(speechId: number, reviewId: number, lastPublishedAt: string | null): boolean {
  if (!lastPublishedAt) return false
  try {
    const seen = localStorage.getItem(seenKey(speechId, reviewId))
    if (!seen) return true
    return new Date(lastPublishedAt).getTime() > new Date(seen).getTime()
  } catch {
    return false
  }
}
