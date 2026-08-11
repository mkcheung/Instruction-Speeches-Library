<?php

namespace App\Http\Resources;

use App\Models\User;
use App\Services\MediaUrlSigner;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * §6.3/§7.1: the reviewer directory row — the ONLY discovery mechanism for
 * picking a reviewer (there is deliberately no "reviewable speeches" open
 * pool). Deliberately narrow: name/username/credential/avatar only, never
 * email or any other contact detail, per the "don't leak sensitive fields"
 * instruction — this is shown to any Member browsing for someone to invite.
 *
 * @mixin User
 */
class ReviewerDirectoryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $profile = $this->profile;

        return [
            'id' => $this->id,
            'username' => $this->username,
            'name' => trim("{$this->first_name} {$this->last_name}"),
            'credential' => $this->getRoleNames()->first(),
            'avatar_url' => $profile?->avatar_path
                ? app(MediaUrlSigner::class)->presign($profile->avatar_path)
                : null,
        ];
    }
}
