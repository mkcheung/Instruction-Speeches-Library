<?php

namespace App\Policies;

use App\Models\Annotation;
use App\Models\Review;
use App\Models\User;
use App\Policies\Concerns\GrantsReviewWriteAccess;

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
    use GrantsReviewWriteAccess;

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
        //
        // Any access-granting status, NOT `published` alone. The plan's
        // worked example says `=== 'published'`, but STEP-05 §"all three
        // names" requires the speaker's track selector to list every
        // accepted reviewer and STEP-05 §43 requires selecting one to show
        // "…hasn't left commentary yet" — "an honest empty state that
        // survives into step 06 unchanged". A published-only gate makes
        // every one of those tracks a guaranteed 403 instead, so the empty
        // state is unreachable and the radiogroup is a list of errors.
        // This widens WHICH REVIEWS the speaker may open, never WHICH ROWS
        // they get back: Annotation::scopeVisibleTo still hands a
        // non-author `published_at IS NOT NULL` only, so an accepted or
        // in_progress review reads as an empty set and a coach's drafts
        // stay invisible — the §8.5 requirement is enforced there, per
        // row, which is the layer that actually holds it.
        if ($review->speech->user_id === $user->id) {
            return in_array($review->status, Review::ACCESS_GRANTING, true);
        }

        return false;                                             // the requirement
    }

    /**
     * STEP-07-write-commentary.md: the write-path gate for annotation
     * CRUD. `reviewerOwnsActiveReview` (GrantsReviewWriteAccess) carries
     * the categorical admin denial, the `revoked_at` check, and the
     * `Review::ACCESS_GRANTING` check — see that trait's docblock for why
     * each is there.
     */
    public function create(User $user, Review $review): bool
    {
        return $this->reviewerOwnsActiveReview($user, $review);
    }

    public function createVoice(User $user, Review $review): bool
    {
        return $user->hasRole('coach') && $this->reviewerOwnsActiveReview($user, $review);
    }

    /**
     * `$annotation->review` is usually already eager-loaded by the
     * controller (`setRelation`, after it confirms the annotation belongs
     * to the caller's own review) before `authorize()` runs — but falls
     * back to a normal lazy load if called from anywhere that hasn't done
     * that, so this method is correct standalone too.
     */
    public function update(User $user, Annotation $annotation): bool
    {
        return $this->reviewerOwnsActiveReview($user, $annotation->review);
    }

    public function delete(User $user, Annotation $annotation): bool
    {
        return $this->reviewerOwnsActiveReview($user, $annotation->review);
    }

    public function retryVoiceTranscript(User $user, Annotation $annotation): bool
    {
        return $user->hasRole('coach') && $this->reviewerOwnsActiveReview($user, $annotation->review);
    }

    public function updateVoiceTranscript(User $user, Annotation $annotation): bool
    {
        return $user->hasRole('coach') && $this->reviewerOwnsActiveReview($user, $annotation->review);
    }

    public function restoreVoice(User $user, Annotation $annotation): bool
    {
        return $user->hasRole('coach') && $this->reviewerOwnsActiveReview($user, $annotation->review);
    }

    public function deleteVoice(User $user, Annotation $annotation): bool
    {
        return $user->hasRole('coach') && $this->reviewerOwnsActiveReview($user, $annotation->review);
    }

    /**
     * STEP-08-essay.md: the essay-write gate, registered as `essay.update`.
     * Deliberately named `essayUpdate` rather than `update` — this method
     * takes a `Review`, not an `Annotation`, and `update()` above is
     * already bound to that other signature via `Gate::define`. Delegates
     * to the exact same `reviewerOwnsActiveReview` trait method as every
     * other write-path ability on this class, per the frozen STEP-08
     * contract's "extend, do not parallel".
     */
    public function essayUpdate(User $user, Review $review): bool
    {
        return $this->reviewerOwnsActiveReview($user, $review);
    }

    /**
     * `essay.publish`. Same delegation as `essayUpdate()` above — publish
     * is a write, subject to the same reviewer-owns-active-review rule
     * `ReviewPolicy::publish` already applies to publishing annotations.
     */
    public function essayPublish(User $user, Review $review): bool
    {
        return $this->reviewerOwnsActiveReview($user, $review);
    }
}
