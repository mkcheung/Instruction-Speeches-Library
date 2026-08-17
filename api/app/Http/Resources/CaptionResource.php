<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * The frozen STEP-09 backend contract §4: `{ captions: { vtt, status, ... } }`.
 * Wraps a plain array (not an Eloquent model — `$this->resource` is built
 * by App\Http\Controllers\Api\CaptionController, since the response
 * combines TWO sources: the `speech_assets` row's own `status`/
 * `failure_code` and the VTT text itself, which lives in object storage,
 * not a column). Reads `$this->resource` as a plain array directly
 * (`JsonResource`'s magic `__get`/`__call` delegate to
 * `$this->resource->{$key}` — OBJECT property access only — so an array
 * resource must be indexed, not dot-accessed, unlike every model-backed
 * resource elsewhere in this codebase).
 */
class CaptionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var array{status: string, vtt: string|null, failure_code: string|null, updated_at: Carbon|null, asset_id: int|null} $data */
        $data = $this->resource;

        return [
            'status' => $data['status'],
            'vtt' => $data['vtt'],
            'failure_code' => $data['failure_code'],
            'updated_at' => $data['updated_at'],
            // §4's retry acceptance criterion ("failure is visible and
            // retryable") needs the asset id so the frontend can call the
            // existing POST /speeches/{speech}/assets/{asset}/retry route
            // (SpeechUploadController::retry, already generalized to
            // handle kind='captions') rather than just refetching a
            // permanently-failed row.
            'asset_id' => $data['asset_id'],
        ];
    }
}
