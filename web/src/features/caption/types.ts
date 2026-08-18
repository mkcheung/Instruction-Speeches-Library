/**
 * STEP-09-FROZEN-CONTRACT.md §4: `GET/PUT /api/speeches/{speech}/captions`.
 * Field names kept snake_case-from-Laravel unconverted, same convention as
 * `features/annotation/types.ts`/`features/essay/types.ts` — this codebase
 * types the JSON envelope as-is, no case converter.
 *
 * ✅ Reconciled against the real backend
 * (`api/app/Http/Controllers/Api/CaptionController.php` +
 * `api/app/Http/Resources/CaptionResource.php`), landed by the parallel
 * backend agent after this slice was first written against the frozen
 * contract's §4 route table alone. Two things the contract's own
 * `{ vtt: string, status, ... }` (with a trailing `...`) didn't spell out,
 * confirmed here:
 *  - `status` has a FIFTH value, `'unavailable'`, beyond the existing
 *    `speech_assets.status` enum (§8's `uploading|processing|ready|
 *    failed`) — synthesized by `CaptionController::show` when no
 *    `captions` asset row exists at all yet (captions were off at upload
 *    time, or nothing has run yet). `vtt` is `null` in that case too.
 *  - `failure_code`/`updated_at` are real, additional fields on the
 *    envelope, not covered by the frozen contract's `...`.
 */
export interface Captions {
  vtt: string | null
  status: 'unavailable' | 'uploading' | 'processing' | 'ready' | 'failed'
  failure_code: string | null
  updated_at: string | null
  /**
   * Added post-reconciliation-audit: the reconciliation-audit agent found
   * `CaptionEditor`'s Retry button only refetched `getCaptions` instead of
   * calling the real, already-generalized
   * `POST /speeches/{speech}/assets/{asset}/retry` endpoint — a `failed`
   * captions asset never actually retries. `asset_id` is needed to call
   * that route (`retryAsset` in `features/speech/speechApi.ts`), so the
   * backend now includes it. `null` only when `status === 'unavailable'`
   * (no asset row exists at all).
   */
  asset_id: number | null
  /**
   * STEP-09-VERIFICATION-PLAN.md §4.1 "Projection convergence token":
   * SHA-256 hex of the canonical VTT this response reflects, `null` only
   * when unavailable. Read-only/server-computed — never sent on the PUT
   * body (see `UpdateCaptionsPayload` below). This is the value the PUT
   * caller compares against `Transcript.caption_revision` to know the
   * server-side re-derivation has actually landed, rather than assuming
   * the save response itself proves it (§4.1/§4.2: "the API save response
   * is not proof that transcript/search is current").
   */
  revision: string | null
}

/**
 * `PUT /api/speeches/{speech}/captions` body. The contract (§4) is
 * explicit that there is NO `lock_version`/optimistic-locking field here
 * — "single-speaker VTT editing... has no concurrent-writer scenario to
 * guard against. Do not add one uninvited." A 422 means server-side VTT
 * validation rejected the body; RTK Query surfaces that as a normal
 * `FetchBaseQueryError` with `status: 422`, no special handling needed
 * beyond what `updateCaptions`'s caller already does for any failure.
 */
export interface UpdateCaptionsPayload {
  vtt: string
}
