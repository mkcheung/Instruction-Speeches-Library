/**
 * STEP-11-FROZEN-CONTRACT.md §9: an erased reviewer's account renders as
 * `{ display_name: 'Former reviewer' }` rather than a `null` reviewer field
 * (ReviewResource/AnnotationController both switched from `whenLoaded()` to
 * `when()` for exactly this — a `null` relation used to short-circuit
 * `whenLoaded()` to `null` without ever building the fallback object).
 * Every consumer of a reviewer identity must resolve through this helper
 * rather than reading `.name` directly, or a `{ display_name }`-shaped
 * object silently yields `undefined` instead of the label.
 */
export interface ReviewerIdentity {
  id?: number
  username?: string
  name?: string
  display_name?: string
}

export function reviewerLabel(reviewer: ReviewerIdentity | null | undefined): string | undefined {
  if (!reviewer) return undefined
  return reviewer.display_name ?? reviewer.name
}
