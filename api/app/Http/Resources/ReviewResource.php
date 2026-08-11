<?php

namespace App\Http\Resources;

use App\Models\Review;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * §7.5's dashboard payload shape — used by both `GET /reviews` (the
 * reviewer's own dashboard) and `GET /speeches/{speech}/reviews` (the
 * speech owner's track selector). `speech`/`reviewer` are conditionally
 * included via whenLoaded so each caller only pays for what it eager-loads.
 *
 * @mixin Review
 */
class ReviewResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'invitation_message' => $this->invitation_message,
            'allow_preview' => $this->allow_preview,
            'prior_commentary_shared' => $this->prior_commentary_shared,
            'invited_at' => $this->invited_at,
            'responded_at' => $this->responded_at,
            'first_published_at' => $this->first_published_at,
            'last_published_at' => $this->last_published_at,
            'last_transition_at' => $this->last_transition_at,
            'revoked_at' => $this->revoked_at,
            'revocation_reason' => $this->revocation_reason,
            'speech' => $this->whenLoaded('speech', fn () => [
                'id' => $this->speech->id,
                'ulid' => $this->speech->ulid,
                'title' => $this->speech->title,
                'owner_name' => $this->speech->relationLoaded('user')
                    ? trim("{$this->speech->user->first_name} {$this->speech->user->last_name}")
                    : null,
            ]),
            'reviewer' => $this->whenLoaded('reviewer', fn () => $this->reviewer === null ? null : [
                'id' => $this->reviewer->id,
                'username' => $this->reviewer->username,
                'name' => trim("{$this->reviewer->first_name} {$this->reviewer->last_name}"),
            ]),
        ];
    }
}
