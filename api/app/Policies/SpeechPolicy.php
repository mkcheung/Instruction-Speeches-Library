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
     * Deliberately NOT a delegation to `view()` either: `view()` also
     * admits a merely-`invited` (not yet accepted) reviewer, since general
     * speech visibility (e.g. seeing the invite exists) is looser than
     * caption/transcript access. Full transcript text is more sensitive
     * than "an invite exists" — an invited-but-not-yet-accepted reviewer
     * must NOT be able to read it. This owns its own query: owner OR an
     * active non-revoked reviewer whose status is in
     * `Review::ACCESS_GRANTING` (accepted/in_progress/published).
     */
    public function readCaptions(User $user, Speech $speech): bool
    {
        if ($speech->user_id === $user->id) {
            return true;
        }

        return $speech->reviews()
            ->where('reviewer_id', $user->id)
            ->whereIn('status', Review::ACCESS_GRANTING)
            ->whereNull('revoked_at')
            ->exists();
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
