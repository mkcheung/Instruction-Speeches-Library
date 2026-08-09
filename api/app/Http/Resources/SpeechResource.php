<?php

namespace App\Http\Resources;

use App\Models\Speech;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * `supersedes`/`superseded_by` are deliberately just `{id, ulid, title}` —
 * enough for the "v2 of {title}" badge (STEP-03-upload-and-watch.md) —
 * never the full chain (§6.11's arc view is a separate, later endpoint) and
 * never bypassing `Speech::scopeVisibleTo`-style access checks once those
 * exist: the chain is a relationship, not a grant.
 *
 * @mixin Speech
 */
class SpeechResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'ulid' => $this->ulid,
            'title' => $this->title,
            'description' => $this->description,
            'delivered_on' => $this->delivered_on?->toDateString(),
            'change_note' => $this->change_note,
            'created_at' => $this->created_at,
            'primary_video' => new SpeechAssetResource($this->whenLoaded('primaryVideo')),
            'supersedes' => $this->when($this->relationLoaded('supersedes') && $this->supersedes !== null, fn () => [
                'id' => $this->supersedes->id,
                'ulid' => $this->supersedes->ulid,
                'title' => $this->supersedes->title,
            ]),
        ];
    }
}
