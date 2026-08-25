<?php

namespace App\Services\Voice;

use App\Models\Annotation;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

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
            $claimed = DB::transaction(function () use ($id): ?array {
                $snapshot = Annotation::withTrashed()->whereKey($id)->first(['id', 'audio_asset_id']);
                if ($snapshot === null || $snapshot->audio_asset_id === null) {
                    return null;
                }
                $asset = SpeechAsset::query()->whereKey($snapshot->audio_asset_id)->lockForUpdate()->first();
                $annotation = Annotation::withTrashed()->whereKey($id)->lockForUpdate()->first();
                if ($asset === null || $annotation === null || $annotation->audio_asset_id !== $asset->id) {
                    return null;
                }
                $claimId = $asset->purge_claim_id ?? (string) Str::uuid();
                if ($asset->status === 'processing') {
                    $asset->update(['status' => 'failed', 'failure_code' => 'voice_storage_failed', 'failure_detail' => 'Voice note is being erased.']);
                }
                $asset->update(['purge_claim_id' => $claimId]);

                return ['claim_id' => $claimId, 'asset_id' => $asset->id, 'disk' => $asset->disk, 'paths' => SpeechAsset::voiceAssetCandidatePaths($asset->temporary_path, $asset->normalization_candidate_path, $asset->path)];
            });
            if ($claimed === null) {
                continue;
            }
            foreach ($claimed['paths'] as $path) {
                if (Storage::disk($claimed['disk'])->exists($path) && ! Storage::disk($claimed['disk'])->delete($path)) {
                    throw new \RuntimeException('Voice-note erasure failed; reviewer identity was retained.');
                }
            }
            DB::transaction(function () use ($id, $claimed, $reviewer, &$counts): void {
                $asset = SpeechAsset::query()->whereKey($claimed['asset_id'])->where('purge_claim_id', $claimed['claim_id'])->lockForUpdate()->first();
                $annotation = Annotation::withTrashed()->whereKey($id)->lockForUpdate()->first();
                if ($asset === null || $annotation === null || $annotation->audio_asset_id !== $asset->id) {
                    return;
                }
                $charged = (int) ($asset->temporary_byte_size ?? $asset->byte_size ?? 0);
                $annotation->update([
                    'audio_asset_id' => null,
                    'transcript_status' => $annotation->body !== '' ? 'ready' : 'not_applicable',
                    'transcript_failure_code' => null,
                    'transcript_attempt_id' => null,
                ]);
                $asset->delete();
                if ($charged > 0) {
                    $this->quota->releaseDirect($reviewer, $charged);
                }
                $counts['voice_notes_deleted']++;
                $counts['annotations_preserved']++;
                $counts['bytes_released'] += $charged;
            });
        }

        return $counts;
    }
}
