<?php

namespace App\Policies;

use App\Models\Review;
use App\Models\User;

/**
 * MODERNIZATION_PLAN §7.1/§7.4. First Policy classes in this codebase —
 * per §7.4 these are advisory (the real enforcement for the self-review
 * rule is App\Services\ReviewService::assertNotSelfReview, not a policy),
 * but every reviewer-initiated transition still gets a policy gate here so
 * controllers stay thin and the categorical "an Admin can never act as a
 * reviewer" rule (§7.1) lives in one place per ability.
 *
 * Method names are plain (`accept`, not `review.accept`) — the dotted
 * ability strings App\Providers\AppServiceProvider's `$mustFallThrough`
 * checks against are registered explicitly via Gate::define in that same
 * provider, mapping e.g. `review.accept` to `ReviewPolicy::accept`, so
 * Gate::before's admin bypass is keyed off the same string the controller
 * actually calls `authorize()` with.
 */
class ReviewPolicy
{
    /**
     * §7.1's categorical rule, spelled out exactly as the plan gives it:
     * an Admin can never accept an invitation, full stop, before any other
     * check runs.
     */
    public function accept(User $user, Review $review): bool
    {
        if ($user->hasRole('admin')) {
            return false;
        }

        return $review->reviewer_id === $user->id
            && $review->status === 'invited'
            && $review->revoked_at === null;
    }

    public function decline(User $user, Review $review): bool
    {
        if ($user->hasRole('admin')) {
            return false;
        }

        return $review->reviewer_id === $user->id
            && $review->status === 'invited'
            && $review->revoked_at === null;
    }

    public function withdraw(User $user, Review $review): bool
    {
        if ($user->hasRole('admin')) {
            return false;
        }

        return $review->reviewer_id === $user->id
            && in_array($review->status, ['invited', 'accepted', 'in_progress'], true)
            && $review->revoked_at === null;
    }

    public function abandon(User $user, Review $review): bool
    {
        if ($user->hasRole('admin')) {
            return false;
        }

        return $review->reviewer_id === $user->id
            && in_array($review->status, ['accepted', 'in_progress'], true)
            && $review->revoked_at === null;
    }

    /**
     * Revocation is the speech owner (or an Admin, unlike the reviewer
     * verbs above — §7.1 lets Admin remove access, it just never lets
     * Admin hold a review) removing access.
     */
    public function revoke(User $user, Review $review): bool
    {
        return $review->speech_owner_id === $user->id || $user->hasRole('admin');
    }

    public function purge(User $user, Review $review): bool
    {
        return $review->speech_owner_id === $user->id || $user->hasRole('admin');
    }

    /**
     * `GET /reviews` — every authenticated Member/Coach may see their own
     * dashboard; nothing role-gated here beyond "is this your row",
     * enforced by the controller scoping the query to `reviewer_id`, not
     * by this policy. Present for symmetry/future use.
     */
    public function viewDirectory(User $user): bool
    {
        return ! $user->hasRole('admin');
    }
}
