<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Database\Query\Builder;

/** Fresh, shared participation checks; deliberately independent of Gate overrides. */
final class ConnectionEligibility
{
    /** @return literal-string */
    public function nameExpression(): string
    {
        return "COALESCE(NULLIF(TRIM(profiles.display_name), ''), TRIM(COALESCE(users.first_name, '') || ' ' || COALESCE(users.last_name, '')))";
    }

    /** A set-based subquery that also permits otherwise eligible roleless people. */
    public function eligibleUserIds(): Builder
    {
        return User::query()->nonAdministrative()
            ->leftJoin('profiles', 'profiles.user_id', '=', 'users.id')
            ->select('users.id')
            ->whereNull('users.suspended_at')
            ->whereNull('users.deleted_at')
            ->whereNull('users.anonymized_at')
            ->whereRaw("TRIM(COALESCE(users.username, '')) <> ''")
            ->whereRaw($this->nameExpression()." <> ''")
            ->toBase();
    }

    public function isEligible(int $userId): bool
    {
        return $this->eligibleUserIds()->where('users.id', $userId)->exists();
    }

    public function assertActor(User $actor): void
    {
        abort_unless($this->isEligible($actor->id), 403, 'Friends are unavailable for this account.');
    }

    /** Re-read at the write boundary; a stale discovery result conveys no authority. */
    public function assertTarget(User $target): void
    {
        abort_unless($this->isEligible($target->id), 404, 'This person is unavailable.');
    }
}
