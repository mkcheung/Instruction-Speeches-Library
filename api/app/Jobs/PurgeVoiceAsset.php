<?php

namespace App\Jobs;

use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

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
        $claim = DB::transaction(function (): ?array {
            $asset = SpeechAsset::query()->whereKey($this->assetId)->lockForUpdate()->first();
            if ($asset === null || $asset->kind !== 'voice_note') {
                return null;
            }
            $claimId = $asset->purge_claim_id ?? (string) Str::uuid();
            $asset->update(['purge_claim_id' => $claimId]);

            return [
                'claim_id' => $claimId,
                'asset_id' => $asset->id,
                'disk' => $asset->disk,
                'paths' => SpeechAsset::voiceAssetCandidatePaths($asset->temporary_path, $asset->normalization_candidate_path, $asset->path),
                'reviewer_id' => $this->reviewerId ?? $asset->purge_reviewer_id,
            ];
        });
        if ($claim === null) {
            return;
        }
        foreach ($claim['paths'] as $path) {
            if (Storage::disk($claim['disk'])->exists($path) && ! Storage::disk($claim['disk'])->delete($path)) {
                throw new \RuntimeException('Voice asset purge failed.');
            }
        }
        DB::transaction(function () use ($claim, $quota): void {
            $fresh = SpeechAsset::query()->whereKey($claim['asset_id'])->where('purge_claim_id', $claim['claim_id'])->lockForUpdate()->first();
            if ($fresh === null) {
                return;
            }
            $charged = (int) ($fresh->temporary_byte_size ?? $fresh->byte_size ?? 0);
            $fresh->delete();
            $reviewerId = $claim['reviewer_id'];
            $reviewer = $reviewerId === null ? null : User::query()->find($reviewerId);
            if ($reviewer !== null && $charged > 0) {
                $quota->releaseDirect($reviewer, $charged);
            }
        });
    }
}
