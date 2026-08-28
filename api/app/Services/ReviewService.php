<?php

namespace App\Services;

use App\Exceptions\SelfReviewNotPermittedException;
use App\Jobs\PurgeDeletedVoiceAnnotation;
use App\Jobs\PurgeVoiceAsset;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
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
     *  - existing row, status `declined`/`abandoned`, OR revoked in any
     *    status -> reuse it: reset to `invited`, clear the revocation
     *    tombstone, refresh `invited_at`/message/flags. This is the
     *    "re-inviting someone who declined reuses the existing row"
     *    acceptance item, plus the revoked case the unique constraint would
     *    otherwise make permanent.
     *  - existing row in any other live status (`invited`, `accepted`,
     *    `in_progress`, `published`) and not revoked -> already
     *    invited/active; return the existing row as-is rather than
     *    duplicating or erroring, so a double-click on "invite" behaves the
     *    same as a double-click on "accept" (both idempotent per the
     *    acceptance criteria) — and, unlike the two branches above, sends
     *    no second notification.
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

        // Whether THIS call is the one that created or reset the invitation.
        // `$review->status === 'invited'` cannot answer that on its own: it
        // is equally true of the idempotent no-op branch, where a repeat
        // invite of an already-invited reviewer would re-send the email and
        // the bell row every time the speaker double-clicks.
        $freshlyInvited = false;

        $review = DB::transaction(function () use ($speech, $reviewer, $speaker, $message, $allowPreview, $priorCommentaryShared, $invitedBy, &$freshlyInvited) {
            $lockedReviewer = User::query()->whereKey($reviewer->id)->lockForUpdate()->firstOrFail();
            abort_if($lockedReviewer->erasure_started_at !== null, 409, 'This reviewer is erasing their account.');
            /** @var Review|null $existing */
            $existing = Review::query()
                ->where('speech_id', $speech->id)
                ->where('reviewer_id', $reviewer->id)
                ->lockForUpdate()
                ->first();

            if ($existing === null) {
                $freshlyInvited = true;

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

            // A revoked row is re-invitable regardless of the status it was
            // revoked under. Without this, `UNIQUE(speech_id, reviewer_id)`
            // makes revocation permanent: the row can never be inserted
            // again, and the branches below would return it untouched — 201
            // Created, no notification, `revoked_at` still set, so the
            // reviewer stays locked out of a speech they were just
            // re-invited to. Revocation is an access-removal event (§7.3),
            // not a ban.
            if ($existing->revoked_at !== null || in_array($existing->status, ['declined', 'abandoned'], true)) {
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
                $freshlyInvited = true;

                return $existing;
            }

            // Already invited/active and not revoked — idempotent no-op,
            // same row returned rather than duplicated or errored.
            return $existing;
        });

        if ($freshlyInvited) {
            $review->setRelation('reviewer', $reviewer);
            $review->setRelation('speech', $speech);
            $review->setRelation('invitedBy', $invitedBy ?? $speaker);
            // `afterCommit`, not a bare call: see `accept`'s docblock — being
            // below the `DB::transaction` above only helps when this service
            // is the outermost transaction, which a caller can change.
            DB::afterCommit(fn () => $reviewer->notify(new ReviewInvited($review)));
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
     *
     * The notification is deferred with `DB::afterCommit`, not merely moved
     * below the `DB::transaction` call. `config/queue.php` sets
     * `after_commit => false` on every connection, so a queued notification
     * dispatched inside an open transaction reaches the worker before the
     * row it describes, and a rollback tells the speaker the review was
     * accepted when it wasn't. Placing it after the closure is not enough:
     * `DB::transaction` nests as a SAVEPOINT, so when a caller wraps this
     * in its own transaction the inner "commit" commits nothing.
     * `afterCommit` fires on the OUTERMOST commit, and runs inline when no
     * transaction is open at all.
     */
    public function accept(Review $review): Review
    {
        [$locked, $transitioned] = DB::transaction(function () use ($review) {
            /** @var Review $locked */
            $locked = Review::query()->with(['speechOwner', 'reviewer', 'speech'])->whereKey($review->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== 'invited') {
                return [$locked, false];
            }

            $locked->status = 'accepted';
            $locked->responded_at = now();
            $locked->last_transition_at = now();
            $locked->save();

            return [$locked, true];
        });

        if ($transitioned) {
            DB::afterCommit(fn () => $locked->speechOwner?->notify(new ReviewAccepted($locked)));
        }

        return $locked;
    }

    public function decline(Review $review): Review
    {
        [$locked, $transitioned] = DB::transaction(function () use ($review) {
            /** @var Review $locked */
            $locked = Review::query()->with(['speechOwner', 'reviewer', 'speech'])->whereKey($review->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== 'invited') {
                return [$locked, false];
            }

            $locked->status = 'declined';
            $locked->responded_at = now();
            $locked->last_transition_at = now();
            $locked->save();

            return [$locked, true];
        });

        if ($transitioned) {
            DB::afterCommit(fn () => $locked->speechOwner?->notify(new ReviewDeclined($locked)));
        }

        return $locked;
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
     *
     * Idempotent, like every other verb here. Re-revoking must NOT re-stamp
     * the tombstone: `revocation_reason` is shown to the reviewer, and a
     * second revoke — a double-click, or a retry after a timeout — arrives
     * with `reason` null from a UI that no longer prompts for one, which
     * would overwrite the explanation they were given with nothing.
     */
    public function revoke(Review $review, User $revokedBy, ?string $reason): Review
    {
        return DB::transaction(function () use ($review, $revokedBy, $reason) {
            /** @var Review $locked */
            $locked = Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();

            if ($locked->revoked_at !== null) {
                return $locked;
            }

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
            $voiceAssets = Annotation::withTrashed()->where('review_id', $review->id)->whereNotNull('audio_asset_id')->pluck('audio_asset_id');
            SpeechAsset::query()->whereIn('id', $voiceAssets)->where('kind', 'voice_note')->update([
                'purge_reviewer_id' => $review->reviewer_id,
            ]);
            SpeechAsset::query()->whereIn('id', $voiceAssets)->where('kind', 'voice_note')->where('status', 'processing')->update(['status' => 'failed', 'failure_code' => 'voice_storage_failed']);
            foreach ($voiceAssets as $assetId) {
                PurgeVoiceAsset::dispatch((int) $assetId, $review->reviewer_id)->afterCommit();
            }
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

            // Re-check the status under the lock, as accept/decline/withdraw/
            // revoke all do. ReviewPolicy::abandon runs against the stale
            // route-model-bound instance, so a publish and an abandon issued
            // near-simultaneously (double-click, two tabs) both passed the
            // policy at `in_progress`; whichever landed second won. Abandon
            // landing second overwrote `published` — dropping the speech out
            // of `Speech::scopeVisibleTo` and 403-ing the speaker on
            // commentary that had already been published to them, with no
            // reviewer-side recovery (ReviewPolicy::publish requires an
            // ACCESS_GRANTING status, which excludes `abandoned`).
            if (! in_array($locked->status, ['accepted', 'in_progress'], true)) {
                return $locked;
            }

            $locked->status = 'abandoned';
            $locked->last_transition_at = now();
            $locked->save();

            return $locked;
        });
    }

    /**
     * STEP-07's uniform security property, applied by the controller to
     * every write route: "never accept a client-supplied review_id" — the
     * caller's own review is always resolved from `(speech, $user)`, never
     * a route or body parameter. `firstOrFail()` 404s when the caller
     * holds no review at all on this speech, which is indistinguishable to
     * them from "this speech has no such review" — exactly the non-leaking
     * behavior STEP-07 calls for.
     *
     * Lives here rather than in `AnnotationController` so the controller
     * stays a thin caller of `ReviewService`, matching the rule this same
     * step already holds `AnnotationService` to (§8.5: "that cannot be a
     * controller's responsibility").
     */
    public function findOwnReview(Speech $speech, User $user): Review
    {
        return Review::query()
            ->where('speech_id', $speech->id)
            ->where('reviewer_id', $user->id)
            ->firstOrFail();
    }

    /**
     * STEP-07-write-commentary.md §8.4: "accepted -> in_progress on first
     * annotation", plus the counter-cache increment every annotation write
     * needs. Called from `App\Services\AnnotationService::create()` on the
     * SAME `Review` instance that method already holds `lockForUpdate()`ed,
     * inside that method's open transaction — this method deliberately
     * takes no lock and opens no transaction of its own. Doing either here
     * would be a second round trip against a row the caller already holds
     * locked, not a correctness fix; it would also risk a second SAVEPOINT
     * inside the same request for no benefit.
     *
     * "First-ever annotation" is read off the counter cache BEFORE
     * incrementing it, not a live COUNT(*) — per §10.4's "check this
     * transactionally against the counter cache under lockForUpdate(), not
     * a live COUNT(*)" (also enforced by the cap check in AnnotationService
     * itself).
     */
    public function recordAnnotationActivity(Review $review): Review
    {
        $isFirstAnnotation = $review->annotations_count === 0;

        $review->annotations_count++;

        if ($isFirstAnnotation && $review->status === 'accepted') {
            $review->status = 'in_progress';
            $review->last_transition_at = now();
        }

        $review->save();

        return $review;
    }

    /**
     * STEP-07 §8.4/§10.2: publish every live draft row in the caller's own
     * review. "Publish" and "publish-additions" are the same call — a
     * review already `published` with nothing new to publish just returns
     * a zero delta without erroring, which is what makes re-running this
     * safe rather than a special second endpoint.
     *
     * The bulk `UPDATE ... WHERE published_at IS NULL` is correct here,
     * unlike `delete()` below, which insists on a single model-instance
     * delete: publish has no per-row side effect beyond the counter, and
     * this method reads the delta directly off the bulk update's own
     * affected-row count rather than issuing a second query to learn it.
     *
     * @return array{0: Review, 1: int} [$review, $publishedCountForThisCall]
     */
    public function publish(Review $review): array
    {
        return DB::transaction(function () use ($review) {
            /** @var Review $locked */
            $locked = Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();

            $delta = Annotation::query()
                ->where('review_id', $locked->id)
                ->whereNull('published_at')
                ->update(['published_at' => now()]);

            $locked->published_annotations_count += $delta;
            $locked->first_published_at ??= now();
            $locked->last_published_at = now();
            $locked->status = 'published';
            $locked->last_transition_at = now();
            $locked->save();

            return [$locked, $delta];
        });
    }

    /**
     * STEP-07: grouped with `abandon()` above per the plan's own text —
     * both route through ReviewService, both are the reviewer's own act
     * over their own set. "Empties the set" is meant as one atomic
     * operation (STEP-07's own wording), so the bulk soft-delete below
     * deliberately skips Annotation's per-row `deleting` event (see that
     * model's own comment) and both counters are reset to 0 directly, in
     * this same transaction, instead of relying on it.
     *
     * Must leave `status`, the access grant (`revoked_at`/`speech_id`/
     * `reviewer_id`) and the acceptance record (`responded_at`) completely
     * untouched — an explicit STEP-07 acceptance criterion, so this method
     * touches nothing on `$locked` besides the two counters.
     */
    public function clearAnnotations(Review $review): Review
    {
        return DB::transaction(function () use ($review) {
            /** @var Review $locked */
            $locked = Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();

            $voiceIds = Annotation::query()->where('review_id', $locked->id)->whereNotNull('audio_asset_id')->pluck('id');
            Annotation::query()->where('review_id', $locked->id)->delete();
            foreach ($voiceIds as $id) {
                PurgeDeletedVoiceAnnotation::dispatch((int) $id)->delay(now()->addSeconds(10));
            }

            $locked->annotations_count = 0;
            $locked->published_annotations_count = 0;
            $locked->save();

            return $locked;
        });
    }
}
