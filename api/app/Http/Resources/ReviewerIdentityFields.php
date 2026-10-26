<?php

namespace App\Http\Resources;

use App\Models\User;

/** The already-loaded reviewer projection; callers decide whether to include it. */
final class ReviewerIdentityFields
{
    /** @return array{display_name: string}|array{id: int, username: ?string, name: string} */
    public static function fromUser(?User $reviewer): array
    {
        if ($reviewer === null || $reviewer->anonymized_at !== null) {
            return ['display_name' => 'Former reviewer'];
        }

        return ['id' => $reviewer->id, 'username' => $reviewer->username,
            'name' => trim("{$reviewer->first_name} {$reviewer->last_name}")];
    }
}
