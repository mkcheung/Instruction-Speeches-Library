/**
 * Matched against the real backend (`api/app/Http/Controllers/Api/
 * SpeechController.php`, `SpeechUploadController.php`,
 * `SpeechResource.php`, `SpeechAssetResource.php`) — STEP-03-upload-and-watch.md.
 */

/** `App\Http\Resources\SpeechAssetResource` — `failure_detail` is
 * admin-only and never reaches this client. `width`/`height`/
 * `poster_time_seconds` are only ever set on poster/sprite rows (STEP-04
 * §9.5) — `null` on `kind: 'source' | 'video' | 'captions'`. */
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
  title: string
  description: string | null
  delivered_on: string | null
  change_note: string | null
  created_at: string
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
