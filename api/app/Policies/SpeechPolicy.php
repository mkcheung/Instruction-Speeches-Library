<?php

namespace App\Policies;

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Support\Role;

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

    /**
     * PLAN-ADMIN-DASHBOARD.md §5.4 — the second row of the eight-hole
     * table, and the one it calls out hardest: "`takedown` has no
     * `Gate::authorize` and no `speech.takedown` ability exists anywhere
     * — the only destructive verb on content, gated solely by
     * `EnsureUserIsAdmin`." This method is that missing ability.
     *
     * Admin-tier, deliberately NOT ownership-scoped: takedown is the one
     * verb in this class that is a moderation power rather than a
     * speaker's power, so it is the inverse of `invite`/`updateCaptions`
     * above. Note it is NOT gated on `Role::SUPER_ADMIN` — §4's matrix
     * puts "Take down / restore speech" in the admin-tier block, not in
     * the super-admin-only block.
     *
     * Per §5.7's standing rule the `speech.takedown` string is added to
     * AppServiceProvider's `$mustFallThrough` in this same commit. That
     * is not redundant with the admin-tier check here even though both
     * currently answer "yes" for an admin: it moves the authority from
     * `Gate::before`'s blanket bypass into this method, so §5.5's
     * mandatory-reason rule and §5.6's byte purge have somewhere to bind
     * that an admin cannot route around.
     *
     * `$speech` is unused today and is kept because it is the hook those
     * later rules need (e.g. an already-trashed speech, or a speech the
     * acting admin owns) — the signature is the contract, not the body.
     */
    public function takedown(User $user, Speech $speech): bool
    {
        return $user->hasAnyRole(Role::ADMIN_TIER);
    }

    /**
     * §6.3's "Speeches — watch, hear, read, restore". The reversing half
     * of `takedown()` and admin-tier for the same reason, by §4's single
     * "Take down / restore speech" row — the two verbs are one capability
     * and splitting their tiers would let an admin remove content that
     * only a super_admin could put back.
     *
     * Also in `$mustFallThrough` per §5.7. Named `restore` to match
     * `AuditAction::SPEECH_RESTORED`; the ability string is the dotted
     * `speech.restore`, registered explicitly in AppServiceProvider like
     * every other dotted ability, so Laravel's conventional `restore`
     * policy ability never has to be guessed at here.
     */
    public function restore(User $user, Speech $speech): bool
    {
        return $user->hasAnyRole(Role::ADMIN_TIER);
    }
}
