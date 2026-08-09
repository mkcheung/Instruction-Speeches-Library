<?php

namespace App\Services;

use App\Models\Speech;
use App\Models\User;
use Illuminate\Validation\ValidationException;

/**
 * MODERNIZATION_PLAN §6.11. The DB's `ck_speeches_supersedes_older` CHECK
 * (`supersedes_id < id`) is the entire cycle defense and needs no PHP
 * mirror. What the DB *cannot* express — the owner of `supersedes_id`
 * lives on a different row of the same table, out of `CHECK`'s reach — is
 * enforced here, the same shape as `assertNotSelfReview` (§6.3).
 */
class SpeechService
{
    /**
     * @param  array{title: string, description?: string|null, delivered_on?: string|null, supersedes_id?: int|null, change_note?: string|null}  $attributes
     *
     * @throws ValidationException
     */
    public function create(User $user, array $attributes): Speech
    {
        if (! empty($attributes['supersedes_id'])) {
            $this->assertLinkableSupersedes($user, (int) $attributes['supersedes_id']);
        }

        return $user->speeches()->create($attributes);
    }

    /**
     * @throws ValidationException
     */
    private function assertLinkableSupersedes(User $user, int $supersedesId): void
    {
        $previous = Speech::query()->find($supersedesId);

        if ($previous === null || $previous->user_id !== $user->id) {
            throw ValidationException::withMessages([
                'supersedes_id' => ['A speech can only supersede an earlier speech by the same speaker.'],
            ]);
        }
    }
}
