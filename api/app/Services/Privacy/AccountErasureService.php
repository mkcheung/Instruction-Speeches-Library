<?php

namespace App\Services\Privacy;

use App\Exceptions\LastAdministratorException;
use App\Models\Annotation;
use App\Models\AuditLog;
use App\Models\Profile;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Models\UsernameHistory;
use App\Services\RoleAssignmentService;
use App\Services\Voice\EraseReviewerVoiceNotes;
use App\Support\AuditAction;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * STEP-11-FROZEN-CONTRACT.md §6 — the account-erasure job, exact order,
 * exact shape. `plan()` is pure (no writes: row/byte counts only) and is
 * used by BOTH `--dry-run` and the real run to print/return identical
 * structure; `execute()` performs the writes and returns the same shape
 * for the audit-entry metadata.
 *
 * The 8 steps below are §6 verbatim, in order:
 *   1. Revoke sessions
 *   2. Delete media at storage (every speech_assets row of a speech this
 *      user OWNS, excluding voice_note rows — those are steps 3a/3b)
 *   3. Delete voice-note audio — two sub-cases:
 *      (a) voice notes THIS user recorded as a reviewer elsewhere
 *      (b) voice notes OTHER reviewers left on speeches this user owns
 *   4. Delete speeches, assets, transcripts, reviews (hard-delete +
 *      CASCADE, safe now that 2-3 emptied the storage bytes those rows
 *      pointed at)
 *   5. Null authorship (reviewer_id -> null on surviving reviews)
 *   6. Hard-delete profile; connections is a no-op (STEP-13 dependency)
 *   7. Anonymize the user row (never delete it)
 *   8. Write the audit entry
 */
class AccountErasureService
{
    public function __construct(
        private readonly EraseReviewerVoiceNotes $eraseReviewerVoiceNotes,
        private readonly RoleAssignmentService $roles,
    ) {}

    public function plan(User $user): ErasurePlan
    {
        $sessionsCount = (int) DB::table('sessions')->where('user_id', $user->id)->count();

        $ownedSpeechIds = Speech::withTrashed()->where('user_id', $user->id)->pluck('id');

        // Step 2: every non-voice-note asset of a speech this user owns.
        // voice_note assets on owned speeches are counted under step 3(b)
        // instead, so they are never double-counted here.
        $mediaAssets = SpeechAsset::query()
            ->whereIn('speech_id', $ownedSpeechIds)
            ->where('kind', '!=', 'voice_note')
            ->get(['id', 'byte_size', 'temporary_byte_size']);
        $mediaBytes = (int) $mediaAssets->sum(fn (SpeechAsset $a) => (int) ($a->temporary_byte_size ?? $a->byte_size ?? 0));

        // Step 3(a): voice notes this user recorded as a REVIEWER, on
        // speeches they do not own. Mirrors EraseReviewerVoiceNotes'
        // own query exactly, read-only.
        $reviewerVoiceAssetIds = Annotation::withTrashed()->whereNotNull('audio_asset_id')
            ->whereHas('review', fn ($q) => $q->where('reviewer_id', $user->id))
            ->pluck('audio_asset_id');
        $reviewerVoiceAssets = SpeechAsset::query()->whereIn('id', $reviewerVoiceAssetIds)->get(['id', 'byte_size', 'temporary_byte_size']);
        $reviewerVoiceBytes = (int) $reviewerVoiceAssets->sum(fn (SpeechAsset $a) => (int) ($a->temporary_byte_size ?? $a->byte_size ?? 0));

        // Step 3(b): voice notes OTHER reviewers left on speeches THIS
        // user owns, about to be destroyed by step 4's CASCADE — the
        // storage bytes are not touched by that CASCADE, so they must be
        // purged explicitly before it runs.
        $ownedReviewIds = Review::query()->whereIn('speech_id', $ownedSpeechIds)->pluck('id');
        $ownedSpeechVoiceAssetIds = Annotation::withTrashed()->whereIn('review_id', $ownedReviewIds)->whereNotNull('audio_asset_id')->pluck('audio_asset_id');
        $ownedSpeechVoiceAssets = SpeechAsset::query()->whereIn('id', $ownedSpeechVoiceAssetIds)->get(['id', 'byte_size', 'temporary_byte_size']);
        $ownedSpeechVoiceBytes = (int) $ownedSpeechVoiceAssets->sum(fn (SpeechAsset $a) => (int) ($a->temporary_byte_size ?? $a->byte_size ?? 0));

        // Step 4: every speech row (including already-soft-deleted ones —
        // a hard-delete pass must not skip a tombstone, or it survives as
        // an orphan forever).
        $speechesCount = $ownedSpeechIds->count();

        // Step 5: reviews where this user is the reviewer, on speeches
        // they do NOT own (speech_owner_id != this user) — reviews on
        // speeches they DO own are already gone via step 4's CASCADE by
        // the time a real run reaches this step, so counting only the
        // surviving population here keeps plan() and execute() reporting
        // the same number.
        $reviewsToNull = Review::query()->where('reviewer_id', $user->id)->where('speech_owner_id', '!=', $user->id)->count();

        // Step 6: profile (0 or 1 row) + connections (no-op, see below).
        $profileCount = Profile::query()->where('user_id', $user->id)->count();

        return new ErasurePlan([
            ['key' => 'sessions_revoked', 'label' => '1. Revoke sessions', 'count' => $sessionsCount, 'bytes' => 0],
            ['key' => 'media_deleted', 'label' => '2. Delete media at storage (owned speeches)', 'count' => $mediaAssets->count(), 'bytes' => $mediaBytes],
            ['key' => 'reviewer_voice_notes_deleted', 'label' => '3a. Delete voice-note audio recorded by this user as a reviewer', 'count' => $reviewerVoiceAssets->count(), 'bytes' => $reviewerVoiceBytes],
            ['key' => 'owned_speech_voice_notes_deleted', 'label' => '3b. Delete voice-note audio left by other reviewers on owned speeches', 'count' => $ownedSpeechVoiceAssets->count(), 'bytes' => $ownedSpeechVoiceBytes],
            ['key' => 'speeches_deleted', 'label' => '4. Delete speeches, assets, transcripts, reviews (cascade)', 'count' => $speechesCount, 'bytes' => 0],
            ['key' => 'reviews_authorship_nulled', 'label' => '5. Null authorship on surviving reviews', 'count' => $reviewsToNull, 'bytes' => 0],
            ['key' => 'profile_deleted', 'label' => '6. Hard-delete profile (connections: no-op, STEP-13 not shipped)', 'count' => $profileCount, 'bytes' => 0],
            ['key' => 'user_anonymized', 'label' => '7. Anonymize the user row', 'count' => 1, 'bytes' => 0],
            ['key' => 'audit_entry_written', 'label' => '8. Write the audit entry', 'count' => 1, 'bytes' => 0],
        ]);
    }

    public function execute(User $user): ErasurePlan
    {
        // §7.4's own rule: "every rule above must ALSO exist as an
        // invariant in the service — policies are advisory." Until now
        // `AccountPolicy::eraseSelf`'s "unless last admin" clause was
        // enforced ONLY at the policy layer (`AccountController::destroy`'s
        // `$this->authorize(...)` call) — any future caller of this
        // service that skips that one controller (an artisan command, a
        // queued scheduled-erasure job, an admin-triggered erasure path)
        // would silently bypass last-admin protection entirely. Found by
        // `/code-review`'s altitude angle; fixed by pushing the same
        // `RoleAssignmentService` check down here, matching how
        // `UserDeletionService::guardedRemoval` already enforces it for
        // suspend/soft-delete rather than trusting `UserPolicy` alone.
        if ($this->roles->wouldOrphanAdminRoster($user)) {
            throw new LastAdministratorException;
        }

        // Gate, before any of the 8 steps: `erasure_started_at` /
        // `voice_erasure_started_at` are the same hard gates
        // `EraseSelfAccount` stamps before its narrower voice-only slice —
        // `ReviewService::invite` and `VoiceNoteService::create` both 409
        // on them. Without this, a review invite or a new voice note
        // recorded against this user as reviewer could land between step
        // 3(a)'s pluck and step 5's null-authorship UPDATE, leaving a
        // voice-note asset that was never purged attached to a review
        // whose `reviewer_id` this same call is about to null out — the
        // exact "audio survives an erased reviewer" outcome §11.2 exists
        // to prevent. Only stamp once: a retry's original instant is the
        // truthful one.
        DB::transaction(function () use ($user): void {
            User::query()->whereKey($user->id)->lockForUpdate()->whereNull('erasure_started_at')->update(['erasure_started_at' => now()]);
            Review::query()->where('reviewer_id', $user->id)->whereNull('voice_erasure_started_at')->lockForUpdate()->get()->each->update(['voice_erasure_started_at' => now()]);
        });

        // Step 1: revoke sessions. No FK on sessions.user_id, plain delete.
        $sessionsRevoked = DB::table('sessions')->where('user_id', $user->id)->delete();

        // Step 2: delete media at storage for every non-voice-note asset
        // of a speech this user owns, claim-then-delete (PurgeVoiceAsset's
        // shape), BEFORE the speeches themselves are hard-deleted.
        $ownedSpeechIds = Speech::withTrashed()->where('user_id', $user->id)->pluck('id');
        $mediaAssetIds = SpeechAsset::query()->whereIn('speech_id', $ownedSpeechIds)->where('kind', '!=', 'voice_note')->pluck('id');
        $mediaCount = 0;
        $mediaBytes = 0;
        foreach ($mediaAssetIds as $assetId) {
            $freed = $this->purgeAssetStorageAndRow($assetId);
            if ($freed !== null) {
                $mediaCount++;
                $mediaBytes += $freed;
            }
        }

        // Step 3(a): voice notes THIS user recorded as a reviewer
        // elsewhere — reuse EraseReviewerVoiceNotes directly (§4 of the
        // frozen contract: "reuse directly", already storage-safe,
        // already keeps the annotation row + its transcript).
        $reviewerVoiceCounts = $this->eraseReviewerVoiceNotes->execute($user);

        // Step 3(b): voice notes OTHER reviewers left on speeches THIS
        // user owns. These annotations are about to be destroyed by step
        // 4's CASCADE regardless, so there is no "keep the row"
        // requirement here — purge storage + the speech_assets row only,
        // purely to stop the CASCADE from leaking the bytes.
        $ownedReviewIds = Review::query()->whereIn('speech_id', $ownedSpeechIds)->pluck('id');
        $ownedSpeechVoiceAssetIds = Annotation::withTrashed()->whereIn('review_id', $ownedReviewIds)->whereNotNull('audio_asset_id')->pluck('audio_asset_id');
        $ownedVoiceCount = 0;
        $ownedVoiceBytes = 0;
        foreach ($ownedSpeechVoiceAssetIds as $assetId) {
            $freed = $this->purgeAssetStorageAndRow($assetId);
            if ($freed !== null) {
                $ownedVoiceCount++;
                $ownedVoiceBytes += $freed;
            }
        }

        // Step 4: hard-delete every speech this user owns. The existing
        // CASCADE chain (speech_assets, speech_transcripts, reviews ->
        // annotations) does the rest at the DB level — safe now that
        // steps 2-3 already emptied the storage bytes those rows pointed
        // at. `withTrashed` so an already-soft-deleted speech is also
        // hard-deleted, not left as a permanent orphan.
        $speechesDeleted = Speech::withTrashed()->where('user_id', $user->id)->forceDelete();

        // Step 5: null authorship for every review where this user is the
        // reviewer. Reviews on speeches this user owned are already gone
        // via step 4's CASCADE, so the explicit `speech_owner_id != user`
        // filter is normally a no-op — added anyway so this UPDATE can't
        // silently drift from plan()'s identically-filtered count query if
        // steps are ever reordered or a partial-retry path is added later.
        $reviewsNulled = Review::where('reviewer_id', $user->id)->where('speech_owner_id', '!=', $user->id)->update(['reviewer_id' => null]);

        // Step 6: hard-delete the profile row explicitly — the FK's own
        // CASCADE never fires this, because the `users` row itself is
        // never hard-deleted (see step 7).
        $profileDeleted = Profile::where('user_id', $user->id)->delete();

        // connections: STEP-13 (social layer) has not shipped yet, so
        // there is no `connections` table to purge. When STEP-13 lands,
        // add the hard-delete here — do not silently forget it.

        // Step 7: anonymize the user row. Never delete it — it must
        // survive to hold FK targets other rows still reference
        // (reviews.reviewer_id on surviving reviews elsewhere,
        // audit_log.actor_id if this user ever acted as an admin, etc).
        if ($user->username !== null) {
            UsernameHistory::query()->create([
                'username' => $user->username,
                'user_id' => $user->id,
                'released_at' => now(),
            ]);
        }
        $user->forceFill([
            'name' => null,
            'first_name' => null,
            'last_name' => null,
            'email' => "erased-{$user->id}@erased.invalid",
            'username' => null,
            'username_changed_at' => null,
            'preferences' => [],
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
            'anonymized_at' => now(),
        ])->save();

        $plan = new ErasurePlan([
            ['key' => 'sessions_revoked', 'label' => '1. Revoke sessions', 'count' => $sessionsRevoked, 'bytes' => 0],
            ['key' => 'media_deleted', 'label' => '2. Delete media at storage (owned speeches)', 'count' => $mediaCount, 'bytes' => $mediaBytes],
            ['key' => 'reviewer_voice_notes_deleted', 'label' => '3a. Delete voice-note audio recorded by this user as a reviewer', 'count' => $reviewerVoiceCounts['voice_notes_deleted'], 'bytes' => $reviewerVoiceCounts['bytes_released']],
            ['key' => 'owned_speech_voice_notes_deleted', 'label' => '3b. Delete voice-note audio left by other reviewers on owned speeches', 'count' => $ownedVoiceCount, 'bytes' => $ownedVoiceBytes],
            ['key' => 'speeches_deleted', 'label' => '4. Delete speeches, assets, transcripts, reviews (cascade)', 'count' => $speechesDeleted, 'bytes' => 0],
            ['key' => 'reviews_authorship_nulled', 'label' => '5. Null authorship on surviving reviews', 'count' => $reviewsNulled, 'bytes' => 0],
            ['key' => 'profile_deleted', 'label' => '6. Hard-delete profile (connections: no-op, STEP-13 not shipped)', 'count' => $profileDeleted, 'bytes' => 0],
            ['key' => 'user_anonymized', 'label' => '7. Anonymize the user row', 'count' => 1, 'bytes' => 0],
            // Step 8 (write the audit entry) is filled in below, once the
            // metadata to write IS this plan itself.
            ['key' => 'audit_entry_written', 'label' => '8. Write the audit entry', 'count' => 1, 'bytes' => 0],
        ]);

        // Step 8: write the audit entry. `subject` is the erased user
        // themselves; `metadata` is the same row/byte counts printed
        // above. Written in controllers/services, never in a Policy
        // (§14) — this IS a service, immediately after the real action.
        AuditLog::query()->create([
            'actor_id' => $user->id,
            'action' => AuditAction::ACCOUNT_ERASED,
            'subject_type' => User::class,
            'subject_id' => $user->id,
            'metadata' => $plan->toMetadata(),
            'created_at' => now(),
        ]);

        return $plan;
    }

    /**
     * Claim-then-delete, the same two-transaction shape
     * `App\Jobs\PurgeVoiceAsset` establishes: lock the row, delete storage
     * (throwing if a delete fails so the row is never removed while bytes
     * remain), then delete the row in a second transaction. Works for any
     * `speech_assets` kind — `SpeechAsset::voiceAssetCandidatePaths()`
     * degrades to a single-path list for a non-voice asset (only `path`
     * is ever non-null there), so this one helper covers both step 2 and
     * step 3(b).
     *
     * Returns the bytes freed, or null if the asset was already gone
     * (another process claimed/deleted it concurrently).
     */
    private function purgeAssetStorageAndRow(int $assetId): ?int
    {
        $claim = DB::transaction(function () use ($assetId): ?array {
            $asset = SpeechAsset::query()->whereKey($assetId)->lockForUpdate()->first();
            if ($asset === null) {
                return null;
            }
            $claimId = $asset->purge_claim_id ?? (string) Str::uuid();
            $asset->update(['purge_claim_id' => $claimId]);

            return [
                'claim_id' => $claimId,
                'asset_id' => $asset->id,
                'disk' => $asset->disk,
                'paths' => SpeechAsset::voiceAssetCandidatePaths($asset->temporary_path, $asset->normalization_candidate_path, $asset->path),
            ];
        });

        if ($claim === null) {
            return null;
        }

        foreach ($claim['paths'] as $path) {
            if (Storage::disk($claim['disk'])->exists($path) && ! Storage::disk($claim['disk'])->delete($path)) {
                throw new \RuntimeException("Account-erasure media purge failed for asset {$claim['asset_id']}.");
            }
        }

        return DB::transaction(function () use ($claim): int {
            $fresh = SpeechAsset::query()->whereKey($claim['asset_id'])->where('purge_claim_id', $claim['claim_id'])->lockForUpdate()->first();
            if ($fresh === null) {
                return 0;
            }
            $bytes = (int) ($fresh->temporary_byte_size ?? $fresh->byte_size ?? 0);
            $fresh->delete();

            return $bytes;
        });
    }
}
