<?php

namespace App\Services;

use App\Exceptions\SelfReviewNotPermittedException;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Notifications\ReviewAccepted;
use App\Notifications\ReviewDeclined;
use App\Notifications\ReviewInvited;
use Illuminate\Support\Facades\DB;

/**
 * MODERNIZATION_PLAN §6.3, §6.11, §7.3, §7.5 — the review state machine.
 * Every transition here writes `last_transition_at` in the same query
 * (§7.5: it is the single sort key every dashboard section orders by), and
 * every write that can race a concurrent identical request (invite/accept)
 * is wrapped in a transaction with `lockForUpdate()` so the outcome is
 * "one row, idempotently", never a duplicate-key exception or a torn write.
 */
class ReviewService
{
    /**
     * Invite (or re-invite) a reviewer for a speech. Idempotent upsert
     * against the table's `UNIQUE(speech_id, reviewer_id)` row, not a
     * blind insert:
     *
     *  - no row yet -> create one, status `invited`.
     *  - existing row, status `declined`/`abandoned`, not revoked -> reuse
     *    it: reset to `invited`, refresh `invited_at`/message/flags. This
     *    is the "re-inviting someone who declined reuses the existing row"
     *    acceptance item.
     *  - existing row in any other live status (`invited`, `accepted`,
     *    `in_progress`, `published`) -> already invited/active; return the
     *    existing row as-is rather than duplicating or erroring, so a
     *    double-click on "invite" behaves the same as a double-click on
     *    "accept" (both idempotent per the acceptance criteria).
     *
     * `assertNotSelfReview` runs first and unconditionally — before any
     * row is touched — because §7.4 requires this to be a service-level
     * refusal a controller/policy can never route around.
     */
    public function invite(
        User $speaker,
        Speech $speech,
        User $reviewer,
        ?string $message,
        bool $allowPreview,
        bool $priorCommentaryShared,
        ?User $invitedBy = null,
    ): Review {
        $this->assertNotSelfReview($speech, $reviewer->id);

        $review = DB::transaction(function () use ($speech, $reviewer, $speaker, $message, $allowPreview, $priorCommentaryShared, $invitedBy) {
            /** @var Review|null $existing */
            $existing = Review::query()
                ->where('speech_id', $speech->id)
                ->where('reviewer_id', $reviewer->id)
                ->lockForUpdate()
                ->first();

            if ($existing === null) {
                return Review::query()->create([
                    'speech_id' => $speech->id,
                    'reviewer_id' => $reviewer->id,
                    'speech_owner_id' => $speaker->id,
                    'invited_by_id' => ($invitedBy ?? $speaker)->id,
                    'invitation_message' => $message,
                    'allow_preview' => $allowPreview,
                    'prior_commentary_shared' => $priorCommentaryShared,
                    'status' => 'invited',
                    'invited_at' => now(),
                    'last_transition_at' => now(),
                ]);
            }

            if (in_array($existing->status, ['declined', 'abandoned'], true)) {
                $existing->fill([
                    'invited_by_id' => ($invitedBy ?? $speaker)->id,
                    'invitation_message' => $message,
                    'allow_preview' => $allowPreview,
                    'prior_commentary_shared' => $priorCommentaryShared,
                    'status' => 'invited',
                    'invited_at' => now(),
                    'responded_at' => null,
                    'revoked_at' => null,
                    'revoked_by_id' => null,
                    'revocation_reason' => null,
                    'last_transition_at' => now(),
                ]);
                $existing->save();

                return $existing;
            }

            // Already invited/active and not revoked — idempotent no-op,
            // same row returned rather than duplicated or errored.
            return $existing;
        });

        if ($review->status === 'invited') {
            $review->setRelation('reviewer', $reviewer);
            $review->setRelation('speech', $speech);
            $review->setRelation('invitedBy', $invitedBy ?? $speaker);
            $reviewer->notify(new ReviewInvited($review));
        }

        return $review;
    }

    /**
     * §6.3/§7.4: a speaker can never hold a review on their own speech.
     * Thrown from here — never checked for in a controller — so the
     * refusal survives regardless of what policy/authorization path (if
     * any) a caller took to get here.
     */
    private function assertNotSelfReview(Speech $speech, int $reviewerId): void
    {
        throw_if($speech->user_id === $reviewerId, SelfReviewNotPermittedException::class, 'A speaker cannot hold a review on their own speech.');
    }

    /**
     * §7.5: idempotent — the acceptance test fires the same reviewer's
     * accept twice concurrently and expects exactly one transition, no
     * duplicate-write error. `lockForUpdate()` inside the transaction
     * serializes the two requests; the second one finds `status` already
     * `accepted` and no-ops.
     */
    public function accept(Review $review): Review
    {
        return DB::transaction(function () use ($review) {
            /** @var Review $locked */
            $locked = Review::query()->with(['speechOwner', 'reviewer', 'speech'])->whereKey($review->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== 'invited') {
                return $locked;
            }

            $locked->status = 'accepted';
            $locked->responded_at = now();
            $locked->last_transition_at = now();
            $locked->save();

            $locked->speechOwner?->notify(new ReviewAccepted($locked));

            return $locked;
        });
    }

    public function decline(Review $review): Review
    {
        return DB::transaction(function () use ($review) {
            /** @var Review $locked */
            $locked = Review::query()->with(['speechOwner', 'reviewer', 'speech'])->whereKey($review->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== 'invited') {
                return $locked;
            }

            $locked->status = 'declined';
            $locked->responded_at = now();
            $locked->last_transition_at = now();
            $locked->save();

            $locked->speechOwner?->notify(new ReviewDeclined($locked));

            return $locked;
        });
    }

    /**
     * The reviewer-initiated pre-completion exit: they walked away before
     * finishing, whether they had merely accepted or were already
     * `in_progress`. Modeled as landing in `declined` (same terminal,
     * re-invitable state as a decline) rather than a new status, since the
     * table's state machine only distinguishes "never engaged"/"walked
     * away" (`declined`) from "coach called it done without commentary"
     * (`abandoned`) — withdraw is the reviewer's own version of the
     * former.
     */
    public function withdraw(Review $review): Review
    {
        return DB::transaction(function () use ($review) {
            /** @var Review $locked */
            $locked = Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();

            if (! in_array($locked->status, ['invited', 'accepted', 'in_progress'], true)) {
                return $locked;
            }

            $locked->status = 'declined';
            $locked->responded_at ??= now();
            $locked->last_transition_at = now();
            $locked->save();

            return $locked;
        });
    }

    /**
     * §7.3: revocation is an access-removal event, not a state-machine
     * transition — it deliberately does NOT touch `status`. A `published`
     * review stays `published` (the commentary existed) but `revoked_at`
     * being non-null is what Speech::scopeVisibleTo/readAnnotations gate
     * on, so the reviewer immediately loses reach to the speech.
     */
    public function revoke(Review $review, User $revokedBy, ?string $reason): Review
    {
        return DB::transaction(function () use ($review, $revokedBy, $reason) {
            /** @var Review $locked */
            $locked = Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();

            $locked->revoked_at = now();
            $locked->revoked_by_id = $revokedBy->id;
            $locked->revocation_reason = $reason;
            $locked->last_transition_at = now();
            $locked->save();

            return $locked;
        });
    }

    /**
     * The hard-delete verb: removes the review row entirely (cascading to
     * annotations once Step 06 introduces that table — not this method's
     * concern). Distinct from `revoke`, which tombstones in place.
     */
    public function revokeAndPurge(Review $review, User $actor): void
    {
        DB::transaction(function () use ($review) {
            Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();
            Review::query()->whereKey($review->id)->delete();
        });
    }

    /**
     * The coach action: calling the review done without ever publishing
     * commentary.
     */
    public function abandon(Review $review): Review
    {
        return DB::transaction(function () use ($review) {
            /** @var Review $locked */
            $locked = Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();

            $locked->status = 'abandoned';
            $locked->last_transition_at = now();
            $locked->save();

            return $locked;
        });
    }

    // accepted -> in_progress is driven by annotation creation, which
    // doesn't exist until Step 06 (STEP-06-watch-commentary.md); no method
    // here yet on purpose.
}
