<?php

namespace App\Jobs;

use App\Models\Annotation;
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
        $claim = DB::transaction(function () use ($snapshot): ?array {
            $asset = SpeechAsset::query()->whereKey($snapshot->audio_asset_id)->lockForUpdate()->first();
            $annotation = Annotation::withTrashed()->whereKey($snapshot->id)->lockForUpdate()->first();
            if ($asset === null || $annotation === null || ! $annotation->trashed() || $annotation->audio_asset_id !== $asset->id) {
                return null;
            }
            $claimId = $asset->purge_claim_id ?? (string) Str::uuid();
            $asset->update(['purge_claim_id' => $claimId, 'status' => 'failed']);

            return ['claim_id' => $claimId, 'asset_id' => $asset->id, 'disk' => $asset->disk, 'paths' => array_unique(array_filter([$asset->temporary_path, $asset->normalization_candidate_path, $asset->path])), 'charged' => (int) ($asset->temporary_byte_size ?? $asset->byte_size ?? 0), 'reviewer_id' => $annotation->review()->value('reviewer_id')];
        });
        if ($claim === null) {
            return;
        }
        foreach ($claim['paths'] as $path) {
            if (Storage::disk($claim['disk'])->exists($path) && ! Storage::disk($claim['disk'])->delete($path)) {
                throw new \RuntimeException('Voice-note object deletion failed.');
            }
        }
        DB::transaction(function () use ($claim, $quota): void {
            $asset = SpeechAsset::query()->whereKey($claim['asset_id'])->where('purge_claim_id', $claim['claim_id'])->lockForUpdate()->first();
            $annotation = Annotation::withTrashed()->whereKey($this->annotationId)->lockForUpdate()->first();
            if ($asset === null || $annotation === null || ! $annotation->trashed() || $annotation->audio_asset_id !== $asset->id) {
                return;
            }
            $annotation->update(['audio_asset_id' => null, 'transcript_status' => 'not_applicable', 'transcript_failure_code' => null, 'transcript_attempt_id' => null]);
            $asset->delete();
            $reviewer = $claim['reviewer_id'] === null ? null : User::query()->find($claim['reviewer_id']);
            if ($reviewer !== null && $claim['charged'] > 0) {
                $quota->releaseDirect($reviewer, $claim['charged']);
            }
        });
    }
}
