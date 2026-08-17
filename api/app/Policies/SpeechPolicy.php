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

    /**
     * STEP-09-captions.md / the frozen STEP-09 backend contract §1.
     * Deliberately NOT `AnnotationPolicy::readAnnotations` — captions/
     * transcripts belong to the Speech and can exist with zero reviews.
     * Reuses `view()`'s exact visibility (owner OR an active non-revoked
     * reviewer per `Review::ACCESS_GRANTING`) because a reviewer coaching
     * a speech needs to read captions/transcript the same as they can
     * watch the video.
     */
    public function readCaptions(User $user, Speech $speech): bool
    {
        return $this->view($user, $speech);
    }

    /**
     * Ownership-only — same shape as `invite()` above. Matches
     * STEP-09.md's "speaker-editable" language and
     * MODERNIZATION_PLAN.md:1760's "The speaker can edit the VTT"
     * verbatim: no reviewer or admin path, ever.
     */
    public function updateCaptions(User $user, Speech $speech): bool
    {
        return $speech->user_id === $user->id;
    }
}
