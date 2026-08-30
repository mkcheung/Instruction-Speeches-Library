/**
 * STEP-06-watch-commentary.md's frozen backend/frontend contract
 * (`step06-contract.md`) — `GET /api/speeches/{speech}/annotations
 * ?review_id={review_id}`. Field names are kept snake_case-from-Laravel
 * unconverted, same convention as `features/speech/types.ts` and
 * `features/review/types.ts` — this codebase types the JSON envelope
 * as-is, no case converter.
 */

export type AnnotationKind = 'praise' | 'correction' | 'observation'
export type VoiceTranscriptStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface AnnotationVoice {
  asset_id: number
  audio_status: 'processing' | 'ready' | 'failed'
  transcript_status: VoiceTranscriptStatus
  failure_code: string | null
}

/** One row of `annotations` in the response body. `id` is a **string** —
 * the contract is explicit that the engine (`web/src/lib/engine.ts`) uses
 * string cue ids throughout, so nothing downstream ever does `Number(id)`.
 *
 * STEP-07-write-commentary.md's frozen contract: `lock_version` (optimistic
 * locking, §10.2) and `client_uuid` (create idempotency key, minted
 * client-side) are additive to the STEP-06 shape above — every existing
 * consumer of `Annotation` (OverlayStack, Transcript, useTimedAnnotations)
 * keeps working unchanged. Deliberately NOT adding a `published_at`/`draft`
 * field here: the frozen contract never named one, and draft-ness for the
 * live preview is presentation-only, decided by the composer (which knows
 * its own in-progress tmp_ id), not a property of the row itself — see
 * `OverlayStack`'s `draftIds` prop.
 */
export interface Annotation {
  id: string
  start_seconds: number
  duration_seconds: number
  kind: AnnotationKind
  topic: string | null
  body: string
  lock_version: number
  client_uuid: string
  voice: AnnotationVoice | null
}

export function isVoiceAnnotation(annotation: Annotation): boolean {
  return annotation.voice !== null
}

export function annotationDisplayBody(annotation: Annotation): string {
  if (!isVoiceAnnotation(annotation)) return annotation.body
  if (annotation.voice?.transcript_status === 'ready') return annotation.body || 'Transcript unavailable.'
  if (annotation.voice?.transcript_status === 'failed') return 'Transcript unavailable.'
  return 'Transcribing…'
}

/** `POST /speeches/{speech}/annotations` body. Idempotent on `client_uuid`
 * — a repeat POST with the same `client_uuid` returns the existing row,
 * 200, not an error (also how the 6-second Undo toast un-deletes: it
 * re-POSTs with the identical `client_uuid` and field values). */
export interface CreateAnnotationPayload {
  client_uuid: string
  body: string
  start_seconds: number
  duration_seconds?: number
  kind?: AnnotationKind
  topic?: string | null
}

export interface CreateVoiceAnnotationPayload {
  client_uuid: string
  audio: Blob
  start_seconds: number
  kind?: AnnotationKind
  topic?: string | null
}

export interface VoiceAudioUrlResponse {
  audio: { url: string; expires_at: string }
}

export type VoiceCommentaryMode = 'play' | 'text' | 'none'

export interface VoiceCommentaryPreferenceResponse {
  voice_commentary: { speech_id: number; mode: VoiceCommentaryMode; experienced: boolean }
}

/** `PATCH /speeches/{speech}/annotations/{annotation}` body — must include
 * the `lock_version` last seen, per §10.2's optimistic locking. */
export interface UpdateAnnotationPayload {
  lock_version: number
  body?: string
  start_seconds?: number
  duration_seconds?: number
  kind?: AnnotationKind
  topic?: string | null
}

/**
 * The 409 response body on a `PATCH` version conflict. `conflictSource` is
 * read from the response rather than hardcoded — the contract says it is
 * ALWAYS the literal string `"self"` for annotations (single-writer-per-
 * review), but the frontend doesn't assume that; it renders whatever the
 * backend actually sent so a reconciliation pass can catch drift.
 */
export interface AnnotationConflictResponse {
  message: string
  conflictSource: string
  current: Annotation
}

function hasConflictShape(value: unknown): value is AnnotationConflictResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'current' in value &&
    typeof (value as { current?: unknown }).current === 'object'
  )
}

/** Type guard for the RTK Query error `data` payload on a 409. */
export function isAnnotationConflict(data: unknown): data is AnnotationConflictResponse {
  return hasConflictShape(data)
}

/** STEP-11-FROZEN-CONTRACT.md §9: `display_name` is present instead of
 * `id`/`username`/`name` when the reviewer's account has been erased —
 * resolve the label via `reviewerLabel()` (`@/lib/reviewerLabel`), never
 * `.name` directly. */
export interface AnnotationsReviewer {
  id?: number
  username?: string
  name?: string
  display_name?: string
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
