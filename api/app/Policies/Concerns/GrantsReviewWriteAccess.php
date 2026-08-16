<?php

namespace App\Policies\Concerns;

use App\Models\Review;
use App\Models\User;

/**
 * STEP-07-write-commentary.md: the "does this user hold this review as an
 * active, non-revoked reviewer" check every write-path policy method in
 * AnnotationPolicy and ReviewPolicy needs — extracted here after an
 * independent review pass found the same five-way copy-paste across both
 * classes (create/update/delete + publish/clearAnnotations).
 *
 * Categorical admin denial (§7.1: an Admin can never act as a reviewer)
 * runs first, unconditionally, before the ownership check — never folded
 * into it.
 *
 * `revoked_at === null` matters even though a revoked reviewer's `status`
 * is untouched by revocation (`ReviewService::revoke` deliberately never
 * touches it): without this check, a revoked reviewer whose status still
 * reads `accepted`/`in_progress` could keep writing after their access was
 * pulled. This mirrors `AnnotationPolicy::readAnnotations`'s own author
 * branch, so write access can never outlive read access for the same
 * reviewer.
 */
trait GrantsReviewWriteAccess
{
    private function reviewerOwnsActiveReview(User $user, Review $review): bool
    {
        if ($user->hasRole('admin')) {
            return false;
        }

        return $review->reviewer_id === $user->id
            && $review->revoked_at === null
            && in_array($review->status, Review::ACCESS_GRANTING, true);
    }
}
