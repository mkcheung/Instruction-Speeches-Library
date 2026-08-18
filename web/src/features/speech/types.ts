/**
 * Matched against the real backend (`api/app/Http/Controllers/Api/
 * SpeechController.php`, `SpeechUploadController.php`,
 * `SpeechResource.php`, `SpeechAssetResource.php`) — STEP-03-upload-and-watch.md.
 */

/** `App\Http\Resources\SpeechAssetResource` — `failure_detail` is
 * admin-only and never reaches this client. `width`/`height` are set on
 * poster/sprite rows (STEP-04 §9.5) and, since PLAN-APP-HEADER.md's W4, on
 * `kind: 'video'` rows too (rotation-corrected — see
 * `FfmpegTranscoder::displayDimensions`), as a `--video-ar` fallback for
 * posterless speeches. Still `null` on `kind: 'source' | 'captions'`, and
 * on any video row transcoded before W4 shipped. `poster_time_seconds`
 * remains poster/sprite-only. */
export interface SpeechAsset {
  id: number
  kind: 'source' | 'video' | 'captions'
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  failure_code: string | null
  duration_seconds: string | null
  width: number | null
  height: number | null
  poster_time_seconds: string | null
}

/** One generated poster asset row (STEP-04 §9.5) — the API produces one of
 * these per width/format combination (320/640/1280 x jpeg/webp). */
export interface SpeechPosterVariant {
  url: string
  width: number
  format: string
}

/** `poster` on `App\Http\Resources\SpeechResource` — conditionally absent
 * (the key itself, not just `null`) when no ready poster asset exists yet. */
export interface SpeechPoster {
  url: string
  width: number
  height: number
  variants: SpeechPosterVariant[]
}

/** `sprite` on `App\Http\Resources\SpeechResource` — conditionally absent
 * the same way `poster` is. `frame_width`/`frame_height` are the tile
 * image's own dimensions (all 5x2 frames together), not one frame's. */
export interface SpeechSprite {
  url: string
  columns: number
  rows: number
  frame_width: number | null
  frame_height: number | null
  duration_seconds: string | null
}

/** `App\Http\Resources\SpeechResource`. `supersedes` is present only when
 * this speech links to an earlier attempt (§6.11) — enough for the "v2 of"
 * badge, not the full arc. `poster`/`sprite` are present only once a ready
 * poster/sprite asset exists (STEP-04 §9.5). */
export interface Speech {
  id: number
  ulid: string
  /** Not confirmed on the current `SpeechResource` as of STEP-04 — added
   * here as an assumed field STEP-05's owner-only affordances (invite
   * button, track selector) need to gate on `user_id === current user's
   * id`. Follow up once the backend half of STEP-05 lands; if the field
   * name or presence differs, this is a one-line fix. */
  user_id?: number
  title: string
  description: string | null
  delivered_on: string | null
  change_note: string | null
  created_at: string
  /** STEP-09-FROZEN-CONTRACT.md §3: the speaker's off-switch for future
   * caption/transcript generation runs (`speeches.captions_enabled`,
   * `NOT NULL DEFAULT true`) — reconciled against the real
   * `SpeechResource`, which now always includes it. Toggling this off
   * does NOT retroactively delete an already-generated transcript, only
   * gates future runs. Written via `PATCH /speeches/{speech}/caption-
   * settings` (`updateCaptionSettings` in `speechApi.ts`) — the
   * captions-settings gap fix that added the missing write surface for
   * this field. */
  captions_enabled: boolean
  primary_video: SpeechAsset | null
  poster?: SpeechPoster
  sprite?: SpeechSprite
  supersedes?: {
    id: number
    ulid: string
    title: string
  }
}

export interface SpeechListResponse {
  speeches: Speech[]
  meta: { current_page: number; last_page: number; total: number }
}

/** `POST /api/speeches` (`CreateSpeechRequest`) — `change_note` is
 * required server-side whenever `supersedes_id` is set (§6.11). */
export interface CreateSpeechPayload {
  title: string
  description?: string | null
  delivered_on?: string | null
  supersedes_id?: number | null
  change_note?: string | null
}

/** `POST /api/speeches/{speech}/assets/uploads` (`CreateUploadRequest`) —
 * `byte_size` is the client's declared, untrusted size (§9.1); the server
 * reconciles against the real size at `complete`. */
export interface CreateUploadPayload {
  original_filename: string
  content_type: string
  byte_size: number
}

export interface CreateUploadResponse {
  asset: SpeechAsset
  upload_id: string
  key: string
}

export interface SignPartResponse {
  url: string
}

export interface CompletedPart {
  part_number: number
  etag: string
}

export interface PlaybackUrlResponse {
  url: string
}

/** `GET /api/queue/transcode-depth` (`QueueStatusController`) — global, not
 * speech-scoped. */
export interface TranscodeDepthResponse {
  depth: number
}

/** `POST /api/speeches/{speech}/assets/{asset}/poster-frame`
 * (`SetPosterFrameRequest`) — `null` means "revert to automatic." */
export interface SetPosterFramePayload {
  time_seconds: number | null
}
