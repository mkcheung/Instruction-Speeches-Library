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
        $asset = SpeechAsset::query()->find($this->assetId);
        if ($asset === null || $asset->kind !== 'voice_note') {
            return;
        }
        foreach (SpeechAsset::voiceAssetCandidatePaths($asset->temporary_path, $asset->normalization_candidate_path, $asset->path) as $path) {
            if (Storage::disk($asset->disk)->exists($path) && ! Storage::disk($asset->disk)->delete($path)) {
                throw new \RuntimeException('Voice asset purge failed.');
            }
        }
        DB::transaction(function () use ($asset, $quota): void {
            $fresh = SpeechAsset::query()->whereKey($asset->id)->lockForUpdate()->first();
            if ($fresh === null) {
                return;
            }
            $charged = (int) ($fresh->temporary_byte_size ?? $fresh->byte_size ?? 0);
            $fresh->delete();
            $reviewerId = $this->reviewerId ?? $fresh->purge_reviewer_id;
            $reviewer = $reviewerId === null ? null : User::query()->find($reviewerId);
            if ($reviewer !== null && $charged > 0) {
                $quota->releaseDirect($reviewer, $charged);
            }
        });
    }
}
