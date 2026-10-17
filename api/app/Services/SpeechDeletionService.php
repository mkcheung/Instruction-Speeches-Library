<?php

namespace App\Services;

use App\Jobs\PurgeSpeechMedia;
use App\Models\AuditLog;
use App\Models\Review;
use App\Models\Speech;
use App\Notifications\SpeechDeleted;
use App\Support\AuditAction;
use App\Support\SpeechDeletionReason;
use Illuminate\Support\Facades\DB;

/**
 * IMPLEMENTATION-PLANS.md §7.5.6/§7.5.3(ii)/§7.5.4. A speaker soft-deleting
 * their OWN speech — distinct from an admin `speech.takedown` (different
 * actor, different AuditAction, a much shorter PurgeSpeechMedia quarantine
 * window, and no admin branch anywhere in this write path).
 *
 * ⚠️ One-row invariant (§7.5.4): this method writes to `speeches` and
 * `audit_log` only (plus the SpeechDeleted notification dispatch, which
 * writes nothing to `reviews`). Do NOT set `revoked_at` on any `reviews`
 * row — tempting ("revoke live grants"), and wrong three ways:
 *
 *  1. Redundant — Speech::scopeVisibleTo's SoftDeletes global scope already
 *     excludes the speech from every read path. The soft delete IS the
 *     revocation.
 *  2. Semantically false — `revoked_at` paired with a null
 *     `revoked_by_id`/reason would tell the coach something untrue:
 *     ReviewService::revoke always pairs it with an actor and a reason.
 *  3. Destroys admin-restore — `restore()` clears `deleted_at` but cannot
 *     un-revoke, so every grant would stay dead even after an admin
 *     restores the speech.
 *
 * If a future diff here touches `reviews`, `annotations` or
 * `speech_transcripts`, it has left the plan.
 */
class SpeechDeletionService
{
    public function deleteOwn(Speech $speech): void
    {
        DB::transaction(function () use ($speech) {
            // withTrashed() is required here, not Speech::query() — the
            // latter carries the SoftDeletes global scope, which would make
            // this firstOrFail() throw ModelNotFoundException for an
            // already-trashed speech instead of reaching the idempotent
            // no-op below. A retry/double-click on a speech this same
            // method already deleted must find the row.
            /** @var Speech $locked */
            $locked = Speech::withTrashed()->whereKey($speech->id)->lockForUpdate()->firstOrFail();

            // Idempotent: a retry/double-click on an already-trashed speech
            // no-ops rather than erroring or re-stamping deleted_reason.
            if ($locked->trashed()) {
                return;
            }

            // §7.5.3(ii): break the supersedes chain in both directions
            // BEFORE the delete, inside this same transaction — mirrors the
            // hard-delete semantics MODERNIZATION_PLAN.md:2119 already
            // mandates ("the chain breaks; the newer speech survives,
            // unlinked"), and fixes the `uq_speeches_successor` slot trap
            // (SupersedeTest.php's "counts a soft-deleted successor as
            // still occupying the slot" case): that index has no
            // `WHERE deleted_at IS NULL` clause, so a soft-deleted speech
            // still occupies its successor slot unless this runs. Two
            // directions: the speech THIS one superseded (freed, so a
            // future attempt can link to it again) and the speech that
            // supersedes THIS one, if any (detached, so it stops claiming
            // to supersede a now-deleted speech). `withTrashed()` on the
            // successor lookup because a trashed successor still occupies
            // the index slot.
            Speech::withTrashed()->where('supersedes_id', $locked->id)->update(['supersedes_id' => null]);
            $locked->supersedes_id = null;

            // Set BEFORE delete() — no window where deleted_at is set and
            // the reason is still null (the "null reads as takedown"
            // convention means a crash between these two writes would
            // misclassify this row forever).
            $locked->deleted_reason = SpeechDeletionReason::OWNER;
            $locked->save();
            $locked->delete();

            AuditLog::query()->create([
                'actor_id' => $locked->user_id,
                'action' => AuditAction::SPEECH_DELETED_BY_OWNER,
                'subject_type' => Speech::class,
                'subject_id' => $locked->id,
                'metadata' => ['title' => $locked->title],
                'ip' => null,
                'user_agent' => null,
                'created_at' => now(),
            ]);

            // §7.5.6: notify every access-granting, non-revoked reviewer —
            // the "an hour of a volunteer coach's time is the most
            // expensive thing this system handles" principle (§7.5.1)
            // applies here too: a reviewer mid-annotation on a speech that
            // just vanished deserves a signal, not silent 410s on their
            // next request.
            $reviewers = $locked->reviews()
                ->whereIn('status', Review::ACCESS_GRANTING)
                ->whereNull('revoked_at')
                ->with('reviewer')
                ->get();

            DB::afterCommit(function () use ($reviewers, $locked) {
                foreach ($reviewers as $review) {
                    $review->reviewer?->notify(new SpeechDeleted($locked->id, $locked->title));
                }
            });

            // §7.5.3(i): the OWNER delete window, not the takedown one —
            // PurgeSpeechMedia's constructor already accepts an explicit
            // override specifically so a caller doesn't have to trust its
            // config default.
            PurgeSpeechMedia::dispatch($locked, (int) config('media.owner_delete_quarantine_days'))->afterCommit();
        });
    }
}
