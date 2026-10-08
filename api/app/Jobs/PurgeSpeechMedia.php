<?php

namespace App\Jobs;

use App\Models\AuditLog;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\QuotaService;
use App\Support\AuditAction;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * PLAN-ADMIN-DASHBOARD.md §5.6 (promoted into Phase 1), fixing the defect
 * §1.3 describes: taking a speech down calls `$record->delete()` — soft.
 * `Speech` uses `SoftDeletes`, so the `ON DELETE CASCADE` on
 * `speech_assets.speech_id` never fires, and every asset row plus every byte
 * survives indefinitely. Of the 21 `Storage::disk(...)->delete(...)` sites in
 * `app/`, only AccountErasureService's own media step ever deleted
 * video/poster/sprite bytes — and that is GDPR self-erasure, never
 * moderation. This job is the moderation path that did not exist.
 *
 * Nothing else reclaims those bytes, including the sweep that looks like it
 * might: MediaReconcileCommand::pruneRetainedOriginals() resolves
 * `captions_enabled` through `Speech::query()`, whose `SoftDeletes` global
 * scope EXCLUDES trashed speeches, so a taken-down speech's `source` misses
 * the `$captionsEnabledBySpeech->has(...)` guard and is skipped — the source
 * is retained forever too. (Recorded because rev 1 of the plan claimed the
 * opposite, and the inverted mechanism would have sent a fix in the wrong
 * direction; see §13 correction #2.)
 *
 * WHAT IS DELETED, AND WHY THAT LIST
 * `source`, `video`, `poster`, `sprite`, `captions` — every kind the
 * SPEAKER's own upload/transcode pipeline produced for this speech, which is
 * exactly the content a takedown is a judgment about.
 *
 * `voice_note` is deliberately spared. That audio belongs to the REVIEWER who
 * recorded it, not to the speaker: AccountErasureService draws the same line
 * twice with `where('kind', '!=', 'voice_note')`, handling voice notes as
 * separate steps 3(a)/3(b) against the REVIEWER's quota, and
 * EraseReviewerVoiceNotes is the reviewer's own erasure path for them. Taking
 * a speech down is not a finding against the coach's commentary, so purging
 * it here would (a) destroy a third party's content on someone else's
 * sanction, (b) release the wrong user's quota, and (c) walk straight through
 * the `purge_claim_id` interlock FfmpegVoiceNoteProcessor gates its publish
 * CAS on. Note the consequence, which is intended: a purged speech can still
 * have reviewer audio attached to it, and the audit row below records how
 * many voice notes were retained so that is visible rather than surprising.
 *
 * `speech_transcripts` is also untouched. This job purges BYTES AT STORAGE
 * (§5.6's subject); the derived transcript text is a DB row that the
 * moderation/appeal trail still needs, and it is destroyed by the CASCADE if
 * and when the speech is ever hard-deleted.
 *
 * WHY THE ROW GOES WITH THE BYTES, RATHER THAN A STATUS TOMBSTONE
 * SpeechAsset's own docblock (§9.4 rule 3): `status` is the only
 * playback-readiness signal, never inferred from `path` existing. A surviving
 * row left at `ready` would therefore be an outright lie — and a cheap one to
 * act on, since MediaUrlSigner::presign() enforces no authorization at all
 * and will happily sign a path whose object is gone. Demoting the row to
 * `failed` instead is worse, not better: SpeechUploadController::retry()
 * accepts ANY `failed` video and re-queues a transcode, so a restored speaker
 * would be handed a Retry button that cannot ever work, the `source` being
 * purged as well. And a dedicated `purged` status would mean rebuilding the
 * `ck_speech_assets_status` CHECK constraint on both drivers.
 *
 * So the row is deleted with its bytes, following the claim-then-delete shape
 * at AccountErasureService::purgeAssetStorageAndRow() that §5.6 names as the
 * in-repo precedent. A restored speech then has no `primaryVideo`, `poster`
 * or `sprite` rows at all: the same media-missing state as a speech whose
 * upload never finished, which every consumer already models — `playbackUrl`
 * 404s on the missing asset instead of signing a dead object, and the player
 * gets "no video", not a 500.
 *
 * THE QUARANTINE WINDOW IS ENFORCED HERE, NOT AT THE DISPATCH SITE
 * §11.2's answer is a 30-day quarantine matching the user soft-delete grace,
 * so a wrongful takedown stays recoverable (`config('media.
 * takedown_quarantine_days')`). This job re-checks that window against
 * `speeches.deleted_at` itself, every run, rather than trusting whoever
 * dispatched it:
 *
 *   - row present, `deleted_at` null  -> the speech is live, or the takedown
 *     was already reversed by the restore action. Refuse. This is the single
 *     check that makes restore-within-the-window keep its media.
 *   - row present, `deleted_at` inside the window -> still quarantined.
 *     Refuse.
 *   - row present, `deleted_at` older than the window -> purge.
 *   - row absent (force-deleted; the CASCADE normally takes the asset rows
 *     too, but not if it was bypassed) -> purge the survivors. The window
 *     exists to protect a restore, and there is nothing left to restore.
 *
 * That makes an eager `PurgeSpeechMedia::dispatch($speech)` at takedown time
 * a harmless no-op instead of an immediate, irreversible deletion: the bytes
 * go when `media:reconcile`'s nightly sweep re-dispatches after the window
 * expires. The sweep is the primary driver precisely because a 30-day
 * `->delay()` is fragile — a job sitting in Redis for a month has to survive
 * every queue restart, Horizon prune and `queue:flush` in between (STEP-14
 * added both Horizon and a `--profile down` that tears the stack down), while
 * `deleted_at` is a durable DB fact. That is the same reasoning
 * MediaReconcileCommand already states for voice tombstones: "soft-deleted
 * annotations ... are durable facts, so sweep them directly rather than
 * trusting Redis to have received the original delayed purge job."
 *
 * QUOTA
 * Only a `ready` `source`'s bytes are credited back, because that is the only
 * thing the speaker was ever charged for: `QuotaService::reserve()` holds the
 * client-declared figure for the upload and `releaseOnComplete()` reconciles
 * it to the source's real `byte_size`, while the derived renditions are never
 * charged at all (TranscodeSpeechAsset, FfmpegTranscoder, GeneratePoster and
 * GenerateCaptions do not touch QuotaService). Crediting their bytes would
 * hand back quota that was never debited. An `uploading`/`failed` source is
 * likewise skipped — its reservation is released by this same command's
 * abandoned-upload sweep hours earlier, and double-releasing is how the user
 * ends up with free quota.
 *
 * This is the first caller `releaseOnSpeechDeleted()` has ever had, and the
 * release path QuotaService's class docblock warns about ("missing any one of
 * them is how a user locks themselves out permanently"): quota follows BYTES,
 * not rows. A takedown keeps charging the speaker while the media is still
 * recoverable, and the charge is dropped at the moment the bytes actually go.
 * The release happens inside the same transaction that deletes the row and is
 * gated on this purge's claim id, so a retry cannot credit it twice.
 *
 * AUDIT
 * One `SPEECH_MEDIA_PURGED` row per purge that actually removed something —
 * never on a refused or already-completed run, or the log fills with nightly
 * no-ops. `actor_id` is null, meaning the system: this is a scheduled
 * consequence of a takedown, not an admin's act 30 days later, and a reader
 * wanting the admin who ordered it can join the same subject's
 * `SPEECH_TAKEN_DOWN` row. §5.6 keeps the two actions separate deliberately —
 * conflating them would record a deletion that has not happened yet.
 *
 * IDEMPOTENCY
 * Safe to run twice, and safe to retry after a partial failure. A storage
 * delete that fails throws BEFORE the row is deleted, so the row survives for
 * the next attempt rather than orphaning a still-billed object; an object
 * already missing is a no-op (`exists()` guard), and its row is still
 * removed; a second complete run finds no purgeable rows, writes no audit row
 * and releases no quota.
 */
class PurgeSpeechMedia implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    /**
     * Every asset kind produced by the speaker's own pipeline. `voice_note`
     * is absent on purpose — see the class docblock. Public because
     * `media:reconcile`'s sweep selects on exactly this list, and two
     * hand-maintained copies of it would drift.
     *
     * @var list<string>
     */
    public const PURGED_KINDS = ['source', 'video', 'poster', 'sprite', 'captions'];

    public int $speechId;

    /**
     * Takes the `Speech` so the takedown action can read
     * `PurgeSpeechMedia::dispatch($speech)`, but keeps only its id:
     * `SerializesModels` would otherwise re-resolve the model on unserialize
     * and `firstOrFail()` on a speech that has since been force-deleted,
     * which is a state this job is specifically supposed to handle.
     *
     * `$quarantineDays` is null for every normal caller (meaning
     * `config('media.takedown_quarantine_days')`). `media:reconcile` passes
     * the window it actually selected on, so an operator overriding the
     * window on the command line cannot end up with a sweep that selects
     * speeches this job then refuses.
     */
    public function __construct(Speech $speech, public ?int $quarantineDays = null)
    {
        $this->speechId = $speech->id;
        $this->afterCommit = true;
    }

    /**
     * Returns whether this run actually removed anything — `false` for
     * every refusal and every already-complete run.
     *
     * The queue worker ignores a job's return value, so this costs nothing
     * on the dispatched path; it exists for the SYNCHRONOUS caller.
     * `MediaReconcileCommand`'s sweep calls `handle()` directly and
     * previously counted every speech it selected, including the ones this
     * method declined (a concurrent runner won the `purge_claim_id` race,
     * or the rows went away between the `SELECT` and the lock) — so the
     * nightly summary reported purges that had not happened.
     */
    public function handle(QuotaService $quota): bool
    {
        $speech = Speech::withTrashed()
            ->whereKey($this->speechId)
            ->first(['id', 'ulid', 'user_id', 'deleted_at']);

        if ($speech !== null && ! $this->quarantineHasExpired($speech)) {
            return false;
        }

        $assets = SpeechAsset::query()
            ->where('speech_id', $this->speechId)
            ->whereIn('kind', self::PURGED_KINDS)
            ->orderBy('id')
            ->get(['id']);

        if ($assets->isEmpty()) {
            return false;
        }

        /** @var array<string, int> $purgedByKind */
        $purgedByKind = [];
        $bytesFreed = 0;

        foreach ($assets as $asset) {
            $purged = $this->purgeAssetStorageAndRow($asset->id, $speech?->user_id, $quota);

            if ($purged === null) {
                continue;
            }

            $purgedByKind[$purged['kind']] = ($purgedByKind[$purged['kind']] ?? 0) + 1;
            $bytesFreed += $purged['bytes'];
        }

        if ($purgedByKind === []) {
            return false;
        }

        ksort($purgedByKind);

        AuditLog::query()->create([
            // Null actor = the system. See the class docblock: the admin who
            // ordered the takedown is on the SPEECH_TAKEN_DOWN row for this
            // same subject.
            'actor_id' => null,
            'action' => AuditAction::SPEECH_MEDIA_PURGED,
            'subject_type' => Speech::class,
            'subject_id' => $this->speechId,
            'metadata' => [
                'speech_ulid' => $speech?->ulid,
                'speech_owner_id' => $speech?->user_id,
                'taken_down_at' => $speech?->deleted_at?->toIso8601String(),
                'quarantine_days' => $this->quarantineWindowDays(),
                'assets_purged' => array_sum($purgedByKind),
                'assets_purged_by_kind' => $purgedByKind,
                'bytes_freed' => $bytesFreed,
                // Recorded so the deliberately narrower-than-it-looks scope
                // is legible from the trail alone: reviewer audio survives a
                // takedown.
                'voice_notes_retained' => SpeechAsset::query()
                    ->where('speech_id', $this->speechId)
                    ->where('kind', 'voice_note')
                    ->count(),
            ],
            'created_at' => now(),
        ]);

        return true;
    }

    /**
     * A live speech (`deleted_at` null) never expires — it was never taken
     * down, or the takedown has already been reversed.
     */
    private function quarantineHasExpired(Speech $speech): bool
    {
        $deletedAt = $speech->deleted_at;

        return $deletedAt !== null
            && $deletedAt->lessThanOrEqualTo(now()->subDays($this->quarantineWindowDays()));
    }

    private function quarantineWindowDays(): int
    {
        return $this->quarantineDays ?? (int) config('media.takedown_quarantine_days');
    }

    /**
     * Claim-then-delete, AccountErasureService::purgeAssetStorageAndRow()'s
     * two-transaction shape (itself PurgeVoiceAsset's): lock the row and
     * stamp a claim, delete storage outside the transaction — throwing if a
     * delete fails, so the row is never removed while bytes remain — then
     * delete the row under a second lock that re-asserts the claim is still
     * ours. A concurrent purge (the nightly sweep racing an eager dispatch)
     * either loses the second lock and returns null, or finds the row
     * already gone; either way the bytes go exactly once.
     *
     * `voiceAssetCandidatePaths()` degrades to a single-element list for
     * these kinds (only `path` is ever non-null), reused rather than
     * open-coded so a future added candidate path is covered in one place —
     * the same reason the erasure service calls it for non-voice assets.
     *
     * @return array{kind: string, bytes: int}|null null if another runner
     *                                              already claimed or
     *                                              deleted this asset
     */
    private function purgeAssetStorageAndRow(int $assetId, ?int $ownerId, QuotaService $quota): ?array
    {
        $claim = DB::transaction(function () use ($assetId): ?array {
            $asset = SpeechAsset::query()->whereKey($assetId)->lockForUpdate()->first();

            // Re-checked under the lock, not trusted from the batch select
            // in handle(): a `voice_note` must never be purged here even if
            // the row's kind somehow changed in between.
            if ($asset === null || ! in_array($asset->kind, self::PURGED_KINDS, true)) {
                return null;
            }

            $claimId = $asset->purge_claim_id ?? (string) Str::uuid();
            $asset->update(['purge_claim_id' => $claimId]);

            return [
                'claim_id' => $claimId,
                'asset_id' => $asset->id,
                'kind' => $asset->kind,
                'disk' => $asset->disk,
                'paths' => SpeechAsset::voiceAssetCandidatePaths($asset->temporary_path, $asset->normalization_candidate_path, $asset->path),
            ];
        });

        if ($claim === null) {
            return null;
        }

        foreach ($claim['paths'] as $path) {
            if (Storage::disk($claim['disk'])->exists($path) && ! Storage::disk($claim['disk'])->delete($path)) {
                throw new \RuntimeException("Takedown media purge failed for speech asset {$claim['asset_id']}.");
            }
        }

        return DB::transaction(function () use ($claim, $ownerId, $quota): ?array {
            $fresh = SpeechAsset::query()
                ->whereKey($claim['asset_id'])
                ->where('purge_claim_id', $claim['claim_id'])
                ->lockForUpdate()
                ->first();

            if ($fresh === null) {
                return null;
            }

            $bytes = (int) ($fresh->byte_size ?? 0);
            // See the class docblock's QUOTA note: a ready source is the
            // only asset the speaker's storage_bytes_used was ever charged
            // for. Resolved before the delete, applied after it, inside the
            // same transaction, so it cannot be credited twice by a retry.
            $wasChargedToOwner = $fresh->kind === 'source' && $fresh->status === 'ready';

            $fresh->delete();

            if ($ownerId !== null && $wasChargedToOwner && $bytes > 0) {
                $quota->releaseOnSpeechDeleted($ownerId, $bytes);
            }

            return ['kind' => $claim['kind'], 'bytes' => $bytes];
        });
    }
}
