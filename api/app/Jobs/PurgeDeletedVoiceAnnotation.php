<?php

namespace App\Jobs;

use App\Enums\SpeechAssetStatus;
use App\Enums\TranscriptStatus;
use App\Models\Annotation;
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

class PurgeDeletedVoiceAnnotation implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public function __construct(public int $annotationId)
    {
        $this->afterCommit = true;
    }

    public function handle(QuotaService $quota): void
    {
        $snapshot = Annotation::withTrashed()->whereKey($this->annotationId)->first(['id', 'audio_asset_id', 'review_id', 'deleted_at']);
        if ($snapshot === null || ! $snapshot->trashed() || $snapshot->audio_asset_id === null) {
            return;
        }
        /** @var array{0: AssetPurgeClaim, 1: int, 2: mixed}|null $claimed */
        $claimed = AnnotationTransactions::run(function () use ($snapshot): ?array {
            $asset = SpeechAsset::query()->whereKey($snapshot->audio_asset_id)->lockForUpdate()->first();
            $annotation = Annotation::withTrashed()->whereKey($snapshot->id)->lockForUpdate()->first();
            if ($asset === null || $annotation === null || ! $annotation->trashed() || $annotation->audio_asset_id !== $asset->id) {
                return null;
            }
            // Failed at claim: every writer that reconciles a reservation filters on processing or ready,
            // so the amount read now is still the amount owed at finalize.
            $claim = AssetPurgeClaim::stamp($asset, ['status' => SpeechAssetStatus::Failed->value]);

            return [$claim, $asset->chargedBytes(), $annotation->review()->value('reviewer_id')];
        });
        if ($claimed === null) {
            return;
        }
        [$claim, $charged, $reviewerId] = $claimed;
        $claim->deleteObjects('Voice-note object deletion failed.');
        AnnotationTransactions::run(function () use ($claim, $charged, $reviewerId, $quota): void {
            $asset = $claim->lockAsset();
            $annotation = Annotation::withTrashed()->whereKey($this->annotationId)->lockForUpdate()->first();
            if ($asset === null || $annotation === null || ! $annotation->trashed() || $annotation->audio_asset_id !== $asset->id) {
                return;
            }
            $annotation->update(['audio_asset_id' => null, 'transcript_status' => TranscriptStatus::NotApplicable->value, 'transcript_failure_code' => null, 'transcript_attempt_id' => null]);
            $asset->delete();
            $reviewer = $reviewerId === null ? null : User::query()->find((int) $reviewerId);
            if ($reviewer !== null && $charged > 0) {
                $quota->releaseDirect($reviewer, $charged);
            }
        });
    }
}
