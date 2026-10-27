<?php

namespace App\Services;

use App\Models\User;
use App\Models\UsernameHistory;
use App\Support\Username;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The one place a user's username is ever written, so the 30-day throttle
 * and the username_history bookkeeping (§6.5) can't be bypassed by a second
 * code path that forgets them.
 */
class UsernameService
{
    private const MIN_DAYS_BETWEEN_CHANGES = 30;

    /**
     * Decisions (no-op, cooldown, availability, history) are made on a fresh
     * row locked FOR UPDATE inside one transaction, never on the caller's
     * possibly stale model; the history row and the rename commit together.
     *
     * The row lock only serializes competing changes by the SAME user. Two
     * different users claiming the same name are arbitrated by the unique
     * index on users.username; that violation (and only that one) is mapped
     * to the ordinary "already taken" validation error.
     *
     * The passed model is refreshed with the committed attributes so callers
     * can keep using it.
     *
     * @throws ValidationException
     */
    public function set(User $user, string $rawUsername): User
    {
        $normalized = Username::normalize($rawUsername);

        try {
            $committed = DB::transaction(fn (): User => $this->setOnLockedUser($user->getKey(), $normalized));
        } catch (UniqueConstraintViolationException $e) {
            if (! $this->isUsernameUniqueViolation($e)) {
                throw $e;
            }

            throw self::takenError();
        }

        $user->setRawAttributes($committed->getAttributes(), true);

        return $user;
    }

    private function setOnLockedUser(mixed $userId, string $normalized): User
    {
        $live = User::query()->whereKey($userId)->lockForUpdate()->firstOrFail();

        if ($live->username === $normalized) {
            return $live;
        }

        // Squatting protection (§6.5), enforced here as well as in
        // App\Rules\UsernameIsAvailable so it holds for any caller of set().
        // These availability reads are a fast path only: a concurrent claim
        // by another user can still win before our save, and that race is
        // caught as a unique-index violation in set().
        $takenByAnotherUser = User::query()
            ->where('username', $normalized)
            ->whereKeyNot($live->getKey())
            ->exists();

        if ($takenByAnotherUser) {
            throw self::takenError();
        }

        $previouslyOwnedBySomeoneElse = UsernameHistory::query()
            ->where('username', $normalized)
            ->where('user_id', '!=', $live->getKey())
            ->exists();

        if ($previouslyOwnedBySomeoneElse) {
            throw ValidationException::withMessages([
                'username' => ['That username was previously used by another account and cannot be reclaimed.'],
            ]);
        }

        $isFirstClaim = $live->username === null;

        if (! $isFirstClaim && $live->username_changed_at !== null) {
            $eligibleAt = CarbonImmutable::parse($live->username_changed_at)->addDays(self::MIN_DAYS_BETWEEN_CHANGES);

            if ($eligibleAt->isFuture()) {
                throw ValidationException::withMessages([
                    'username' => ["You can change your username again on {$eligibleAt->toDateString()}."],
                ]);
            }
        }

        if (! $isFirstClaim) {
            UsernameHistory::query()->create([
                'username' => $live->username,
                'user_id' => $live->getKey(),
                'released_at' => now(),
            ]);
        }

        $live->username = $normalized; // normalized again by the model mutator; idempotent
        $live->username_changed_at = now();
        $live->save();

        return $live;
    }

    private static function takenError(): ValidationException
    {
        return ValidationException::withMessages([
            'username' => ['That username is already taken.'],
        ]);
    }

    /**
     * Driver messages differ (SQLite "users.username", PostgreSQL
     * "users_username_unique"); other unique indexes on users (e.g. email)
     * must not be reported as a username conflict.
     */
    private function isUsernameUniqueViolation(UniqueConstraintViolationException $e): bool
    {
        $message = $e->getPrevious()?->getMessage() ?? $e->getMessage();

        return str_contains($message, 'users.username') || str_contains($message, 'users_username_unique');
    }
}
