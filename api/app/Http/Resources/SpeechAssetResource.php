<?php

namespace App\Http\Resources;

use App\Models\SpeechAsset;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * `failure_detail` is admin-only (§9.2) and deliberately absent here — only
 * `failure_code`, a user-safe string, ever reaches the speaker.
 *
 * @mixin SpeechAsset
 */
class SpeechAssetResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'status' => $this->status,
            'failure_code' => $this->failure_code,
            'duration_seconds' => $this->duration_seconds,
        ];
    }
}
