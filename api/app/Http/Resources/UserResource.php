<?php

namespace App\Http\Resources;

use App\Models\User;
use App\Support\Onboarding;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin User
 */
class UserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'email' => $this->email,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'username' => $this->username,
            // Same expression PublicProfileResource already uses (§Backend
            // item 1, PLAN-APP-HEADER.md) — a header deriving a name from
            // first_name/last_name alone would disagree with the user's own
            // profile page for anyone who set a display name.
            'display_name' => $this->profile?->display_name
                ?: trim("{$this->first_name} {$this->last_name}"),
            'email_verified' => $this->email_verified_at !== null,
            'roles' => $this->getRoleNames(),
            'onboarding_completed' => (bool) $this->profile?->onboarding_completed_at,
            'onboarding_step' => Onboarding::currentStep($this->resource),
            // §7.8: surface the same three QuotaService columns the
            // Filament UserResource already renders for admins
            // (api/app/Filament/Resources/UserResource.php:155-215),
            // so an end user (and the frontend's pre-flight check +
            // quota meter) can see their own usage instead of only
            // discovering the limits when reserve() throws. /api/me is
            // already fetched on every authenticated route and RTK
            // Query dedupes client-side, so this adds no new request.
            'storage_bytes_used' => $this->storage_bytes_used,
            'quota_bytes' => $this->quota_bytes,
            'uploads_in_flight' => $this->uploads_in_flight,
        ];
    }
}
