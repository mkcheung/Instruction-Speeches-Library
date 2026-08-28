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
     * @param  array{title: string, description?: string|null, delivered_on?: string|null, supersedes_id?: int|null, change_note?: string|null, captions_enabled?: bool}  $attributes
     *
     * @throws ValidationException
     */
    public function create(User $user, array $attributes): Speech
    {
        if (! empty($attributes['supersedes_id'])) {
            $this->assertLinkableSupersedes($user, (int) $attributes['supersedes_id']);
        }

        $speech = $user->speeches()->create($attributes);

        // `::create()` does NOT hydrate DB-level column defaults into the
        // in-memory model, and `captions_enabled` is default-only when the
        // client omits it (CreateSpeechRequest marks it `sometimes` for
        // exactly that reason). Reading it back off the returned model gave
        // null, which `SpeechResource` cast to `false` — so every speech
        // created through the UI reported captions OFF while the row said
        // `true` and GenerateCaptions was in fact running. Third instance
        // of this bug class here after `captions_enabled` in EnsureCaptionJob
        // and `lock_version`; CaptionController::updateSettings already
        // works around it the same way.
        return $speech->refresh();
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

        // The at-most-one-successor half of the invariant was left entirely
        // to the `uq_speeches_successor` partial unique index, so a second
        // link to the same attempt surfaced as an uncaught QueryException —
        // a 500 with no field-level error, where the cross-owner failure
        // just above returns a clean 422. `withTrashed()` because the index
        // does not exclude soft-deleted rows: a tombstoned successor still
        // occupies the slot even though `supersededBy()` reports null.
        $alreadySuperseded = Speech::withTrashed()
            ->where('supersedes_id', $supersedesId)
            ->exists();

        if ($alreadySuperseded) {
            throw ValidationException::withMessages([
                'supersedes_id' => ['That attempt already has a newer version.'],
            ]);
        }
    }
}
