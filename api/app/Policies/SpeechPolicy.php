<?php

namespace App\Policies;

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;

/**
 * MODERNIZATION_PLAN §7.1/§7.3/§7.4. `invite` is ownership-only — per §7.1
 * an Admin never becomes a reviewer, and there's no separate "admin invites
 * on someone's behalf" ability here (App\Services\ReviewService::invite's
 * `$invitedBy` parameter covers admin-assisted attribution without an
 * Admin needing this ability). `view` mirrors Speech::scopeVisibleTo for
 * callers that want a single-instance check rather than a query scope; the
 * controller-level scope remains the authoritative source per §7.3.
 */
class SpeechPolicy
{
    public function invite(User $user, Speech $speech): bool
    {
        return $speech->user_id === $user->id;
    }

    public function view(User $user, Speech $speech): bool
    {
        if ($speech->user_id === $user->id) {
            return true;
        }

        return $speech->reviews()
            ->where('reviewer_id', $user->id)
            ->whereIn('status', ['invited', ...Review::ACCESS_GRANTING])
            ->whereNull('revoked_at')
            ->exists();
    }
}
