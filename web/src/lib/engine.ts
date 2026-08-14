/**
 * The pure half of MODERNIZATION_PLAN.md §8.2 "The engine — corrected".
 *
 * These functions have zero DOM / backend dependency and are the input to
 * the cue-timing overlay: `normalize` is the ONE normalization function used
 * by both the reconciler and the cue builder, `computeActive` derives the
 * active-cue set from data + `currentTime` synchronously (never from
 * `track.activeCues`, which is stale-by-spec on cue insertion — see §8.2),
 * and `timingSignature` lets a caller key cue rebuilds on *timing* alone so
 * a body-text edit doesn't storm `cuechange` on every video on the page.
 */

/**
 * A single annotation's raw, possibly-invalid timing input.
 *
 * Field names are `start_seconds`/`duration_seconds` — the exact JSON keys
 * from `GET /api/speeches/{speech}/annotations` (STEP-06's frozen
 * contract) — deliberately NOT renamed to camelCase. The contract's
 * `useTimedAnnotations(videoEl, cues, opts)` takes the API response's
 * `annotations` array "mapped 1:1 (no renaming) except each cue is run
 * through a single normalize() function before use," so this type (and
 * `normalize`'s signature) has to speak the wire format directly rather
 * than through an intermediate renamed shape.
 */
export interface CueSpec {
  id: string
  start_seconds: number
  duration_seconds: number
}

/** Pure, exported, unit-testable without a browser. */
/** ONE normalization function, used by BOTH the reconciler and the cue builder. */
export function normalize(c: CueSpec): { start: number; end: number } | null {
  if (!Number.isFinite(c.start_seconds)) return null
  const start = Math.max(0, c.start_seconds)
  // Math.max(0.05, NaN) is NaN — an unguarded duration makes `end` NaN,
  // `t < NaN` false, and the annotation silently never appears.
  const dur =
    Number.isFinite(c.duration_seconds) && c.duration_seconds > 0
      ? c.duration_seconds
      : 6
  return { start, end: start + Math.max(0.05, dur) }
}

export function computeActive(
  cues: readonly CueSpec[],
  t: number,
): ReadonlySet<string> {
  const out = new Set<string>()
  for (const c of cues) {
    const n = normalize(c)
    if (!n) continue
    if (n.start <= t && t < n.end) out.add(c.id) // spec: start <= position < end
  }
  return out
}

/**
 * Only TIMING may rebuild cues — a body edit must not.
 *
 * A stable string built by mapping each cue to `${id}|${start}|${dur}`
 * (the RAW, un-normalized start/duration, so a caller can distinguish "the
 * clamped timing is unchanged" from "the raw input changed but clamps to
 * the same normalized window" — the signature is a change-detector over
 * input, not over `normalize()`'s output), sorted by id for determinism so
 * two arrays with the same cues in a different order produce the same
 * signature.
 */
export function timingSignature(cues: readonly CueSpec[]): string {
  return cues
    .map((c) => `${c.id}|${c.start_seconds}|${c.duration_seconds}`)
    .sort()
    .join(';')
}
