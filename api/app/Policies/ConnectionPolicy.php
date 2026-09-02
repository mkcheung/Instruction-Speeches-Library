<?php

namespace App\Policies;

use App\Models\Connection;
use App\Models\User;

/**
 * MODERNIZATION_PLAN §6.7.2 / STEP-13-FROZEN-CONTRACT.md §11. Plain
 * public bool-returning methods per ability, matching SpeechPolicy/
 * ReviewPolicy's style. `request`/`accept`/`decline`/`unblock` are
 * self-scoped like `AccountPolicy::eraseSelf` — no ownership ambiguity, so
 * they don't need a Gate ability at all (the service methods themselves
 * already resolve "my own row" server-side, same as
 * ReviewService::findOwnReview). `block` is the one ability that needs an
 * explicit Gate, registered in AppServiceProvider and added to
 * `$mustFallThrough` in the same commit — omitting that step is the exact
 * bug class §11 warns has happened twice before in this project's history.
 */
class ConnectionPolicy
{
    /**
     * Symmetric: either party to a pair may block the other. There is no
     * ownership check beyond "you are one of the two people in this
     * relationship" — unlike ReviewPolicy::revoke, an Admin never gets a
     * bypass path here (§7.1's "Admin never acts as a party to a
     * connection" reasoning, same as it never acts as a reviewer).
     */
    public function block(User $user, Connection $connection): bool
    {
        if ($user->hasRole('admin')) {
            return false;
        }

        return $connection->owner_id === $user->id || $connection->peer_id === $user->id;
    }
}
