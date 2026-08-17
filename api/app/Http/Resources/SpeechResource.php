<?php

namespace App\Http\Resources;

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\MediaUrlSigner;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;

/**
 * `supersedes`/`superseded_by` are deliberately just `{id, ulid, title}` —
 * enough for the "v2 of {title}" badge (STEP-03-upload-and-watch.md) —
 * never the full chain (§6.11's arc view is a separate, later endpoint) and
 * never bypassing `Speech::scopeVisibleTo`-style access checks once those
 * exist: the chain is a relationship, not a grant.
 *
 * `poster`/`sprite` (§9.5) read off an `assets` eager-load constrained to
 * `kind IN ('poster','sprite')` by the controller (`->relationLoaded`
 * guards below), NOT off individual per-row queries — issuing one query per
 * speech here would be an N+1 across `index()`'s paginated list.
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
        /** @var Collection<int, SpeechAsset> $posters */
        $posters = $this->relationLoaded('assets')
            ? $this->assets->where('kind', 'poster')->where('status', 'ready')
            : new Collection;

        /** @var SpeechAsset|null $primaryPoster */
        $primaryPoster = $posters->first(fn (SpeechAsset $asset) => $asset->is_primary);

        /** @var SpeechAsset|null $sprite */
        $sprite = $this->relationLoaded('assets')
            ? $this->assets->first(fn (SpeechAsset $asset) => $asset->kind === 'sprite' && $asset->status === 'ready')
            : null;

        return [
            'id' => $this->id,
            'ulid' => $this->ulid,
            'user_id' => $this->user_id,
            'title' => $this->title,
            'description' => $this->description,
            'delivered_on' => $this->delivered_on?->toDateString(),
            'change_note' => $this->change_note,
            'captions_enabled' => (bool) $this->captions_enabled,
            'created_at' => $this->created_at,
            'primary_video' => new SpeechAssetResource($this->whenLoaded('primaryVideo')),
            'poster' => $this->when($primaryPoster !== null, fn () => [
                'url' => $this->presignPoster($primaryPoster->path),
                'width' => $primaryPoster->width,
                'height' => $primaryPoster->height,
                'variants' => $posters->map(fn (SpeechAsset $asset) => [
                    'url' => $this->presignPoster($asset->path),
                    'width' => $asset->width,
                    'format' => $asset->format,
                ])->values()->all(),
            ]),
            'sprite' => $this->when($sprite !== null, fn () => [
                'url' => $this->presignPoster($sprite->path),
                // Fixed geometry per the spec's ffmpeg call
                // (`fps=10/DURATION,scale=160:-2,tile=5x2`): 5 columns x 2
                // rows = 10 frames. `frame_width`/`frame_height` come off
                // the sprite row's own width/height (the tile's dimensions,
                // not a single frame's) so the frontend can compute
                // click-position -> timestamp without hardcoding 160px.
                'columns' => 5,
                'rows' => 2,
                'frame_width' => $sprite->width,
                'frame_height' => $sprite->height,
                'duration_seconds' => $this->whenLoaded('primaryVideo', fn () => $this->primaryVideo?->duration_seconds),
            ]),
            'supersedes' => $this->when($this->relationLoaded('supersedes') && $this->supersedes !== null, fn () => [
                'id' => $this->supersedes->id,
                'ulid' => $this->supersedes->ulid,
                'title' => $this->supersedes->title,
            ]),
        ];
    }

    /**
     * §9.5: posters get a 1-hour TTL (vs. the video's 10-minute default in
     * MediaUrlSigner::DEFAULT_TTL_SECONDS) because there is no seek-refresh
     * mechanism behind a plain `<img>` the way §9.3 has one for `<video>`.
     */
    private function presignPoster(string $path): string
    {
        return app(MediaUrlSigner::class)->presign($path, 3600);
    }
}
