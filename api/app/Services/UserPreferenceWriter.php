<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/** Merge only an explicitly written namespace after re-reading the shared user row under lock. */
final class UserPreferenceWriter
{
    /** @param array<string, mixed> $entry */
    public function updateVoice(User $user, int $speechId, array $entry): User
    {
        return $this->write($user, 'voice_commentary', $speechId, $entry);
    }

    /** @param array<string, mixed> $entry */
    public function updatePlayback(User $user, int $speechId, array $entry): User
    {
        return $this->write($user, 'commentary_playback', $speechId, $entry);
    }

    /**
     * @param  'voice_commentary'|'commentary_playback'  $namespace
     * @param  array<string, mixed>  $entry
     */
    private function write(User $user, string $namespace, int $speechId, array $entry): User
    {
        return DB::transaction(function () use ($user, $namespace, $speechId, $entry): User {
            $fresh = $user->newQuery()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $preferences = $fresh->preferences ?? [];
            $entries = $preferences[$namespace] ?? [];
            // An explicit write repairs only its own malformed namespace. Read resolution stays fail-closed.
            $preferences[$namespace] = is_array($entries) ? $entries : [];
            $preferences[$namespace][(string) $speechId] = $entry;
            $fresh->update(['preferences' => $preferences]);

            return $fresh;
        });
    }
}
