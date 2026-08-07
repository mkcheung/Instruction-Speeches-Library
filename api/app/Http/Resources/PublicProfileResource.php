<?php

namespace App\Http\Resources;

use App\Models\User;
use App\Services\MediaUrlSigner;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The public `/u/{username}` payload. Identity only, per S1's deliberate
 * stub (no timeline, no connections rail) — everything here is either
 * already public-by-definition (name, username) or explicitly opted into
 * public display (bio, avatar).
 *
 * @mixin User
 */
class PublicProfileResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $profile = $this->profile;

        return [
            'username' => $this->username,
            'display_name' => $profile?->display_name ?: trim("{$this->first_name} {$this->last_name}"),
            'pronouns' => $profile?->pronouns,
            'bio' => $profile?->bio,
            'location' => $profile?->location,
            'avatar_url' => $profile?->avatar_path
                ? app(MediaUrlSigner::class)->presign($profile->avatar_path)
                : null,
        ];
    }
}
