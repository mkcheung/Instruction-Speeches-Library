import type { Speech } from '@/features/speech/types'

/**
 * STEP-09-FROZEN-CONTRACT.md §4: `GET /api/speeches/{speech}/transcript` ->
 * `{ transcript: { body, segments, word_count, words_per_minute, language,
 * model, source } }`.
 *
 * ✅ Envelope shape (`body`/`segments`/`word_count`/`words_per_minute`/
 * `language`/`model`/`source`, plus `updated_at`) reconciled against the
 * real backend (`api/app/Http/Controllers/Api/TranscriptController.php` +
 * `api/app/Http/Resources/TranscriptResource.php`), landed by the
 * parallel backend agent. `source` is nullable — `TranscriptController::
 * show`'s no-row-yet branch returns `source: null` (not one of the
 * `speech_transcripts.source` CHECK values), for a speech with no
 * transcript at all yet, distinct from a real `'whisper'`/`'edited'` row.
 *
 * ⚠️ `segments`'s PER-ROW shape is still an ASSUMPTION — `TranscriptResource`
 * passes `speech_transcripts.segments` through as opaque `jsonb` with no
 * per-key documentation anywhere in the backend either (STEP-09-captions.md's
 * backend section only ever says "`segments` jsonb with timing"). `start`/
 * `end` in fractional seconds (matching WebVTT's own units, since §6.12
 * says the row is "parsed from that VTT") is the most likely shape and is
 * kept as the single highest-risk guess left in this slice — confirm
 * against a real generated row (or `App\Services\Captions\
 * TranscriptDeriver`, which builds this column) before shipping.
 */
export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  body: string
  segments: TranscriptSegment[]
  word_count: number
  words_per_minute: number | null
  language: string | null
  model: string | null
  /** Postgres `CHECK (source IN ('whisper', 'edited'))` per §8 of the
   * contract — `'edited'` once a speaker-edited caption line has
   * re-derived this row; `null` when no transcript row exists yet at all
   * (`TranscriptController::show`'s empty-state branch). */
  source: 'whisper' | 'edited' | null
  updated_at: string | null
}

/**
 * `GET /api/speeches/search?q=...` -> `{ results: SpeechResource[] }`
 * (§4). Each result is a full `Speech` (the same resource `speechApi.ts`
 * already types) — search returns full speech cards, not a
 * transcript-shaped projection, so the existing `Speech` type is reused
 * rather than inventing a parallel `SearchResult` shape.
 */
export type SpeechSearchResult = Speech
