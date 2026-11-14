<?php

namespace App\Jobs;

use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use App\Support\AnnotationTransactions;
use App\Support\AssetPurgeClaim;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class PurgeVoiceAsset implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public function __construct(public int $assetId, public ?int $reviewerId)
    {
        $this->afterCommit = true;
    }

    public function handle(QuotaService $quota): void
    {
        // Claim BEFORE deleting any object, the same two-phase shape
        // PurgeDeletedVoiceAnnotation and EraseReviewerVoiceNotes already
        // use. This job was the one purge path that never wrote
        // `purge_claim_id`, which defeats the interlock every other
        // participant reads: FfmpegVoiceNoteProcessor gates both its
        // candidate CAS and its publish CAS on `purge_claim_id` being null,
        // so an unclaimed purge let a concurrent normalization publish a
        // normalized copy of the reviewer's audio into storage *after* the
        // hard purge — where no row-driven sweep (`media:reconcile`) can
        // ever find it again.
        /** @var array{0: AssetPurgeClaim, 1: int|null}|null $claimed */
        $claimed = AnnotationTransactions::run(function (): ?array {
            $asset = SpeechAsset::query()->whereKey($this->assetId)->lockForUpdate()->first();
            if ($asset === null || $asset->kind !== 'voice_note') {
                return null;
            }

            return [AssetPurgeClaim::stamp($asset), $this->reviewerId ?? $asset->purge_reviewer_id];
        });
        if ($claimed === null) {
            return;
        }
        [$claim, $reviewerId] = $claimed;
        $claim->deleteObjects('Voice asset purge failed.');
        AnnotationTransactions::run(function () use ($claim, $reviewerId, $quota): void {
            $fresh = $claim->lockAsset();
            if ($fresh === null) {
                return;
            }
            // Read at finalize: the status is unchanged, so a temporary-object cleanup may have reconciled the reservation since the claim.
            $charged = $fresh->chargedBytes();
            $fresh->delete();
            $reviewer = $reviewerId === null ? null : User::query()->find($reviewerId);
            if ($reviewer !== null && $charged > 0) {
                $quota->releaseDirect($reviewer, $charged);
            }
        });
    }
}
