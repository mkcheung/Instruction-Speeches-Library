/**
 * Matched against the real backend (`api/app/Http/Controllers/Api/
 * SpeechController.php`, `SpeechUploadController.php`,
 * `SpeechResource.php`, `SpeechAssetResource.php`) — STEP-03-upload-and-watch.md.
 */

/** `App\Http\Resources\SpeechAssetResource` — `failure_detail` is
 * admin-only and never reaches this client. */
export interface SpeechAsset {
  id: number
  kind: 'source' | 'video' | 'captions'
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  failure_code: string | null
  duration_seconds: string | null
}

/** `App\Http\Resources\SpeechResource`. `supersedes` is present only when
 * this speech links to an earlier attempt (§6.11) — enough for the "v2 of"
 * badge, not the full arc. */
export interface Speech {
  id: number
  ulid: string
  title: string
  description: string | null
  delivered_on: string | null
  change_note: string | null
  created_at: string
  primary_video: SpeechAsset | null
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
