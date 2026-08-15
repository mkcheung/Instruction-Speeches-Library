<?php

namespace App\Http\Resources;

use App\Models\Annotation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * STEP-06 froze this shape for playback; STEP-07-write-commentary.md
 * additively extends it for the authoring surface (`lock_version`,
 * `client_uuid`) rather than replacing it — STEP-06's playback consumers
 * ignore fields they don't use, so this remains backward-compatible.
 *
 * `id` is cast to a string deliberately — §8.2's engine keys cue rebuilds
 * on string ids because optimistic creates use `tmp_…` client ids and
 * `Number()` on those yields `NaN`, so the API contract matches that from
 * the start rather than the frontend having to stringify server ids
 * itself. `start_seconds`/`duration_seconds` are cast to float, not left
 * as the model's `decimal:3` string cast, to match the contract's
 * JSON-number example (`14.0`, not `"14.000"`).
 *
 * @mixin Annotation
 */
class AnnotationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'start_seconds' => (float) $this->start_seconds,
            'duration_seconds' => (float) $this->duration_seconds,
            'kind' => $this->kind,
            'topic' => $this->topic,
            'body' => $this->body,
            'lock_version' => (int) $this->lock_version,
            'client_uuid' => $this->client_uuid,
        ];
    }
}
