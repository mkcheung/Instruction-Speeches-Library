/**
 * STEP-06-watch-commentary.md's frozen backend/frontend contract
 * (`step06-contract.md`) — `GET /api/speeches/{speech}/annotations
 * ?review_id={review_id}`. Field names are kept snake_case-from-Laravel
 * unconverted, same convention as `features/speech/types.ts` and
 * `features/review/types.ts` — this codebase types the JSON envelope
 * as-is, no case converter.
 */

export type AnnotationKind = 'praise' | 'correction' | 'observation'

/** One row of `annotations` in the response body. `id` is a **string** —
 * the contract is explicit that the engine (`web/src/lib/engine.ts`) uses
 * string cue ids throughout, so nothing downstream ever does `Number(id)`. */
export interface Annotation {
  id: string
  start_seconds: number
  duration_seconds: number
  kind: AnnotationKind
  topic: string | null
  body: string
}

export interface AnnotationsReviewer {
  id: number
  name: string
}

/** `GET /api/speeches/{speech}/annotations?review_id=...` response body.
 * `annotations` arrives pre-sorted `ORDER BY start_seconds, id` — never
 * re-sorted client-side. Empty state (a review with zero fixtures, or the
 * "No commentary" choice, which never calls this endpoint at all) is
 * `"annotations": []` at HTTP 200 — 403/404/422 are real errors, not
 * "no commentary," and must surface as an explicit error state rather
 * than a silent empty render (see `annotationApi.ts`). */
export interface AnnotationsResponse {
  review_id: number
  /** Nullable: `reviews.reviewer_id` is `ON DELETE SET NULL`, so a review
   * whose reviewer's account was later deleted still has annotation rows
   * but no reviewer to attach a name to. */
  reviewer: AnnotationsReviewer | null
  annotations: Annotation[]
}
