<?php

namespace App\Services;

use App\Models\User;
use App\Models\UsernameHistory;
use App\Support\Username;
use Carbon\CarbonImmutable;
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
     * @throws ValidationException
     */
    public function set(User $user, string $rawUsername): User
    {
        $normalized = Username::normalize($rawUsername);

        if ($user->username === $normalized) {
            return $user;
        }

        // Squatting protection (§6.5) enforced here too, not just in
        // App\Rules\UsernameIsAvailable — this class is the one place a
        // username is ever written, so the invariant must hold even for a
        // caller that reaches `set()` directly without going through the
        // HTTP validation layer.
        $previouslyOwnedBySomeoneElse = UsernameHistory::query()
            ->where('username', $normalized)
            ->where('user_id', '!=', $user->id)
            ->exists();

        if ($previouslyOwnedBySomeoneElse) {
            throw ValidationException::withMessages([
                'username' => ['That username was previously used by another account and cannot be reclaimed.'],
            ]);
        }

        $isFirstClaim = $user->username === null;

        if (! $isFirstClaim && $user->username_changed_at !== null) {
            $eligibleAt = CarbonImmutable::parse($user->username_changed_at)->addDays(self::MIN_DAYS_BETWEEN_CHANGES);

            if ($eligibleAt->isFuture()) {
                throw ValidationException::withMessages([
                    'username' => ["You can change your username again on {$eligibleAt->toDateString()}."],
                ]);
            }
        }

        if (! $isFirstClaim) {
            UsernameHistory::query()->create([
                'username' => $user->username,
                'user_id' => $user->id,
                'released_at' => now(),
            ]);
        }

        $user->username = $normalized; // normalized again by the model mutator; idempotent
        $user->username_changed_at = now();
        $user->save();

        return $user;
    }
}
