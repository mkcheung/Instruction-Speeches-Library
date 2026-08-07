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
            'id' => $this->id,
            'email' => $this->email,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'username' => $this->username,
            'email_verified' => $this->email_verified_at !== null,
            'roles' => $this->getRoleNames(),
            'onboarding_completed' => (bool) $this->profile?->onboarding_completed_at,
            'onboarding_step' => Onboarding::currentStep($this->resource),
        ];
    }
}
