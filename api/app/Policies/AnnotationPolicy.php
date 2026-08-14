<?php

namespace App\Policies;

use App\Models\Review;
use App\Models\User;

/**
 * MODERNIZATION_PLAN §7.3 "Requirement: coaches may not read each other's
 * commentary" — reproduced here near-verbatim from the plan's own worked
 * example, because the plan is explicit that the obvious version of this
 * function gets three things wrong (see the three corrections below).
 *
 * This is the REVIEW-level gate — "does this user get to see ANY
 * annotations for this review at all". It answers nothing about which
 * individual rows; that's Annotation::scopeVisibleTo, applied only after
 * this gate has already passed, inside App\Services\AnnotationService.
 */
class AnnotationPolicy
{
    public function readAnnotations(User $user, Review $review): bool
    {
        // The author, unless their access was revoked — then a read-only
        // tombstone only (title and dates), which is a separate, narrower
        // ability not implemented by this method. Correction #1: "loses
        // all access" and `return true` for the author cannot both be
        // true — a revoked coach must not keep full read.
        if ($review->reviewer_id === $user->id) {
            return $review->revoked_at === null;
        }

        // Admin moderation, audited. Unconditional in rev 4 — an admin can
        // no longer author commentary (§7.1), so "admin who is also a
        // reviewer here" is now unreachable. The assert() below is a
        // DEFENSIVE assertion, not a live mechanism: if a review ever
        // appears under an admin, isolation still wins.
        if ($user->hasRole('admin')) {
            assert(! Review::where('speech_id', $review->speech_id)
                ->where('reviewer_id', $user->id)->exists(),
                'Admins must not hold reviews — see ReviewPolicy::accept.');

            return true;
        }

        // The speaker. Correction #2: `revoked_at` must NOT appear in this
        // branch. Revocation hides the coach's access, NOT the speaker's:
        // published commentary was delivered and they relied on it.
        // Destroying it is the separate, double-confirmed `revoke and
        // purge` action. Correction #3: `published_annotations_count` is
        // NEVER used here — it's a counter cache (§7.5: counter caches
        // drift), and a drifted counter would silently deny a speaker
        // commentary they were actually delivered. `status` is the only
        // authorization input.
        if ($review->speech->user_id === $user->id) {
            return $review->status === 'published';
        }

        return false;                                             // the requirement
    }
}
