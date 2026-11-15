<?php

namespace App\Services\Voice;

use App\Enums\SpeechAssetStatus;
use App\Enums\TranscriptStatus;
use App\Models\Annotation;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use App\Support\AnnotationTransactions;
use App\Support\AssetPurgeClaim;

class EraseReviewerVoiceNotes
{
    public function __construct(private readonly QuotaService $quota) {}

    /** @return array{voice_notes_deleted:int,annotations_preserved:int,bytes_released:int} */
    public function execute(User $reviewer): array
    {
        $counts = ['voice_notes_deleted' => 0, 'annotations_preserved' => 0, 'bytes_released' => 0];
        $ids = Annotation::withTrashed()->whereNotNull('audio_asset_id')
            ->whereHas('review', fn ($query) => $query->where('reviewer_id', $reviewer->id))->pluck('id');

        foreach ($ids as $id) {
            $claim = AnnotationTransactions::run(function () use ($id): ?AssetPurgeClaim {
                $snapshot = Annotation::withTrashed()->whereKey($id)->first(['id', 'audio_asset_id']);
                if ($snapshot === null || $snapshot->audio_asset_id === null) {
                    return null;
                }
                $asset = SpeechAsset::query()->whereKey($snapshot->audio_asset_id)->lockForUpdate()->first();
                $annotation = Annotation::withTrashed()->whereKey($id)->lockForUpdate()->first();
                if ($asset === null || $annotation === null || $annotation->audio_asset_id !== $asset->id) {
                    return null;
                }
                // The note stays live as text: show a processing asset as failed while erasure runs. A ready asset stays ready (and playable) unless erasure finishes.
                $failed = $asset->status === SpeechAssetStatus::Processing->value
                    ? ['status' => SpeechAssetStatus::Failed->value, 'failure_code' => 'voice_storage_failed', 'failure_detail' => 'Voice note is being erased.']
                    : [];

                return AssetPurgeClaim::stamp($asset, $failed);
            });
            if ($claim === null) {
                continue;
            }
            $claim->deleteObjects('Voice-note erasure failed; reviewer identity was retained.');
            $released = AnnotationTransactions::run(function () use ($id, $claim, $reviewer): ?int {
                $asset = $claim->lockAsset();
                $annotation = Annotation::withTrashed()->whereKey($id)->lockForUpdate()->first();
                if ($asset === null || $annotation === null || $annotation->audio_asset_id !== $asset->id) {
                    return null;
                }
                $charged = $asset->chargedBytes();
                $annotation->update([
                    'audio_asset_id' => null,
                    'transcript_status' => $annotation->body !== '' ? TranscriptStatus::Ready->value : TranscriptStatus::NotApplicable->value,
                    'transcript_failure_code' => null,
                    'transcript_attempt_id' => null,
                ]);
                $asset->delete();
                if ($charged > 0) {
                    $this->quota->releaseDirect($reviewer, $charged);
                }

                return $charged;
            });
            if ($released !== null) {
                $counts['voice_notes_deleted']++;
                $counts['annotations_preserved']++;
                $counts['bytes_released'] += $released;
            }
        }

        return $counts;
    }
}
