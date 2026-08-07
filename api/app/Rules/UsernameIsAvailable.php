<?php

namespace App\Rules;

use App\Models\ReservedUsername;
use App\Models\User;
use App\Models\UsernameHistory;
use App\Support\Username;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Format + reservation + collision, all server-side (§6.5). The value
 * received here is the RAW candidate as typed — normalization happens
 * inside this rule (and again, identically, when the value is actually
 * written) so what is validated and what is stored can never drift.
 */
class UsernameIsAvailable implements ValidationRule
{
    public function __construct(private readonly ?int $ignoreUserId = null) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('The :attribute must be a string.');

            return;
        }

        $normalized = Username::normalize($value);

        if (! Username::isValidFormat($normalized)) {
            $fail('Usernames must be 3-30 characters: lowercase letters, numbers, and _ . - (not at the start or end).');

            return;
        }

        // Postgres note: this was originally written as
        // `ReservedUsername::query()->whereKey($normalized)->exists() ||
        // ...->where('username', ...)`, a copy-paste leftover that compared
        // the bigint primary key column against a username STRING —
        // sqlite silently coerces this to false and the second half of the
        // `||` masked it completely in the Pest suite; real Postgres
        // throws `invalid input syntax for type bigint`, only found by
        // actually curling this endpoint against the real database.
        if (ReservedUsername::query()->where('username', $normalized)->exists()) {
            $fail('That username is reserved and cannot be used.');

            return;
        }

        $takenByAnotherUser = User::query()
            ->where('username', $normalized)
            ->when($this->ignoreUserId, fn ($q) => $q->whereKeyNot($this->ignoreUserId))
            ->exists();

        if ($takenByAnotherUser) {
            $fail('That username is already taken.');

            return;
        }

        // Squatting protection (§6.5): a released username cannot be
        // reclaimed by someone else, ever — not just "for a while."
        $previouslyOwnedBySomeoneElse = UsernameHistory::query()
            ->where('username', $normalized)
            ->when($this->ignoreUserId, fn ($q) => $q->where('user_id', '!=', $this->ignoreUserId))
            ->exists();

        if ($previouslyOwnedBySomeoneElse) {
            $fail('That username was previously used by another account and cannot be reclaimed.');
        }
    }
}
