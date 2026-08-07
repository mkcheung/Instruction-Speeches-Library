<?php

namespace App\Support;

use App\Models\User;

/**
 * Derives "what step is this user on" from which columns are already
 * populated, rather than a dedicated step-tracking column (judgement call,
 * STEP-01-identity.md: "don't add a separate step-tracking column unless
 * you have a good reason"). Each of the three onboarding endpoints writes
 * straight to `users`/`profiles`, so a user who quits after step 2 and
 * returns tomorrow is simply a row with step-1 and step-2 fields populated
 * and `onboarding_completed_at` still null — exactly the state this reads.
 *
 * Steps:
 *   1 — names + username (users.first_name/last_name/username)
 *   2 — bio + pronouns + location (profiles, all individually skippable)
 *   3 — avatar (profiles.avatar_path); this step's submission is what sets
 *       onboarding_completed_at, whether or not an avatar was actually
 *       uploaded (bio/avatar are skippable per §6.5) — it is the *last*
 *       step's completion that gates writes visible to others, not the
 *       presence of every field.
 *   4 — done (onboarding_completed_at is set)
 */
final class Onboarding
{
    public static function currentStep(User $user): int
    {
        if ($user->profile?->onboarding_completed_at !== null) {
            return 4;
        }

        if ($user->username === null || $user->first_name === null || $user->last_name === null) {
            return 1;
        }

        $profile = $user->profile;

        if ($profile === null || ($profile->bio === null && $profile->pronouns === null && $profile->location === null)) {
            return 2;
        }

        return 3;
    }
}
