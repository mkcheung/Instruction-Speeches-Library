/**
 * STEP-08-essay.md's frozen contract (`STEP-08-FROZEN-CONTRACT.md`) —
 * `GET/PUT /api/speeches/{speech}/essay`, `POST /api/speeches/{speech}
 * /essay/publish`. Field names are kept snake_case-from-Laravel
 * unconverted, same convention as `features/annotation/types.ts` and
 * `features/review/types.ts` — this codebase types the JSON envelope
 * as-is, no case converter.
 *
 * The essay lives on `reviews` as six extra columns (a fourth thing a
 * review owns, alongside the access grant, the annotation set and the
 * playback track) — it is NOT a separate resource with its own id. One
 * `Essay` per review, always present once the review row exists (nullable
 * fields, not a missing row), which is why `useEssayEditor` never has an
 * annotations-style "tmp id / brand new draft" branch — every PUT is an
 * update, never a create.
 */
export interface Essay {
  essay_html: string | null
  /** Plain-text projection, derived server-side on write — read-only from
   * the frontend's perspective, never sent in a PUT body. */
  essay_text: string | null
  /** `null` = draft, same idiom as `Review`'s own timestamp fields. */
  essay_published_at: string | null
  essay_updated_at: string | null
  essay_words: number
  /** Separate from `Annotation['lock_version']` by design (STEP-08's
   * "Watch for" section) — sharing one counter would make every annotation
   * write invalidate the essay editor's version and vice versa. */
  essay_lock_version: number
}

/**
 * `PUT /api/speeches/{speech}/essay` body. Reconciled against the real
 * backend (`UpdateEssayRequest::rules()`): `html`/`lock_version` is exactly
 * right, confirmed field-for-field against
 * `app/Http/Requests/Essay/UpdateEssayRequest.php`.
 */
export interface UpdateEssayPayload {
  html: string
  lock_version: number
}

/**
 * The 409 response body on a `PUT` version conflict — copied from
 * `EssayConflictException`, which the contract says copies
 * `AnnotationConflictException` exactly: `{ message, conflictSource:
 * 'self', current: EssayResource }`. `conflictSource` is read from the
 * response rather than hardcoded, same reasoning as
 * `AnnotationConflictResponse`.
 */
export interface EssayConflictResponse {
  message: string
  conflictSource: string
  current: Essay
}

function hasConflictShape(value: unknown): value is EssayConflictResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'current' in value &&
    typeof (value as { current?: unknown }).current === 'object'
  )
}

/** Type guard for the RTK Query error `data` payload on a 409. */
export function isEssayConflict(data: unknown): data is EssayConflictResponse {
  return hasConflictShape(data)
}
