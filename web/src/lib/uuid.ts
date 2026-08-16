/**
 * STEP-07-write-commentary.md's `client_uuid` idempotency key (§10.1: "a
 * `client_uuid` idempotency key minted in the browser… retrofitting this
 * after the client is written requires a client rewrite — do it day one").
 *
 * Wraps `crypto.randomUUID()` with no fallback polyfill — every browser
 * this codebase already requires (per SPIKE-RESULTS.md's
 * `requestVideoFrameCallback` bar, STEP-06) ships it, and so does the Node
 * runtime Vitest runs under.
 */
export function newClientUuid(): string {
  return crypto.randomUUID()
}

/**
 * `AnnotationResource`'s own docblock (`api/app/Http/Resources/
 * AnnotationResource.php`) documents this exact convention: "optimistic
 * creates use `tmp_…` client ids." Used as an annotation's `id` before its
 * first successful save, then replaced by the real server id — string ids
 * throughout (never `Number(id)`) is why `Annotation.id` and `CueSpec.id`
 * are both typed `string`.
 */
export function tmpAnnotationId(clientUuid: string): string {
  return `tmp_${clientUuid}`
}

export function isTmpAnnotationId(id: string): boolean {
  return id.startsWith('tmp_')
}
