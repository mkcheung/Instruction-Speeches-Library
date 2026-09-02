<?php

namespace App\Http\Resources;

use App\Models\Connection;
use App\Services\MediaUrlSigner;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A single mirrored `connections` row, from ITS OWNER's perspective —
 * `peer` is always "the other person". Deliberately identity-only on the
 * peer (name/username/avatar/connected-since), matching §6.7.1's table: "a
 * connection does permit... their profile page reachable", never speech or
 * annotation content.
 *
 * @mixin Connection
 */
class ConnectionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $peer = $this->whenLoaded('peer');
        $profile = $peer?->profile;

        return [
            'id' => $this->id,
            'state' => $this->state,
            'initiated_by_id' => $this->initiated_by_id,
            'note' => $this->note,
            'requested_at' => $this->requested_at,
            'responded_at' => $this->responded_at,
            'connected_at' => $this->connected_at,
            'peer' => $this->when($peer !== null, fn () => [
                'id' => $peer->id,
                'username' => $peer->username,
                'name' => trim("{$peer->first_name} {$peer->last_name}"),
                'avatar_url' => $profile?->avatar_path
                    ? app(MediaUrlSigner::class)->presign($profile->avatar_path)
                    : null,
            ]),
        ];
    }
}
