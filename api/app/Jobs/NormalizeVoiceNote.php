<?php

namespace App\Jobs;

use App\Models\Annotation;
use App\Models\SpeechAsset;
use App\Services\QuotaService;
use App\Services\Voice\VoiceNoteProcessorContract;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

class NormalizeVoiceNote implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 300;

    public int $tries = 1;

    public bool $failOnTimeout = true;

    public function __construct(public int $assetId, public string $temporaryPath)
    {
        $this->afterCommit = true;
        $this->connection = 'redis-long';
        $this->queue = 'transcode';
    }

    public function handle(VoiceNoteProcessorContract $processor): void
    {
        $asset = SpeechAsset::query()->find($this->assetId);
        if ($asset === null) {
            Storage::disk('media')->delete($this->temporaryPath);

            return;
        }
        if ($asset->purge_claim_id !== null || $asset->voiceAnnotation()->first() === null) {
            return;
        }
        if ($asset->temporary_path !== $this->temporaryPath || ! $processor->process($asset, $this->temporaryPath)) {
            if ($asset->temporary_path !== $this->temporaryPath) {
                Storage::disk($asset->disk)->delete($this->temporaryPath);
            }

            return;
        }

        $attemptId = $asset->voiceAnnotation()->value('transcript_attempt_id');
        $annotationId = $asset->voiceAnnotation()->value('id');
        if (is_string($attemptId) && is_numeric($annotationId)) {
            try {
                TranscribeVoiceNote::dispatch((int) $annotationId, $asset->id, $attemptId);
            } catch (Throwable $exception) {
                Annotation::query()->whereKey((int) $annotationId)
                    ->where('audio_asset_id', $asset->id)
                    ->where('transcript_attempt_id', $attemptId)
                    ->where('transcript_status', 'pending')
                    ->update(['transcript_status' => 'failed', 'transcript_failure_code' => 'voice_transcription_failed']);
                throw $exception;
            }
        }
    }

    public function failed(Throwable $exception): void
    {
        $asset = SpeechAsset::query()->find($this->assetId);
        if ($asset === null || $asset->status !== 'processing' || $asset->temporary_path !== $this->temporaryPath) {
            return;
        }
        $reserved = (int) ($asset->temporary_byte_size ?? $asset->byte_size);
        $candidatePath = null;
        $won = DB::transaction(function () use ($asset, $reserved, &$candidatePath): bool {
            $fresh = SpeechAsset::query()->whereKey($asset->id)->where('status', 'processing')->whereNull('purge_claim_id')->where('temporary_path', $this->temporaryPath)->lockForUpdate()->first();
            if ($fresh === null || $fresh->temporary_byte_size === null) {
                return false;
            }
            // Resolved under this same lock, not from the pre-transaction
            // $asset snapshot: the annotation/review this reservation
            // belongs to can be concurrently hard-deleted (ReviewService::
            // clearAnnotations/revokeAndPurge) between this method's entry
            // and the lock being acquired above. Reading the reviewer off
            // a stale outer snapshot could resolve null even though the
            // row was still live moments ago, silently skipping the
            // release and leaking the reserved bytes out of the user's
            // quota permanently — the exact class of bug QuotaService's
            // own docblock warns against elsewhere in this codebase.
            $reviewer = $fresh->voiceAnnotation()->first()?->review()->first()?->reviewer()->first();
            $candidatePath = $fresh->normalization_candidate_path;
            $fresh->update(['status' => 'failed', 'failure_code' => 'voice_normalization_failed', 'failure_detail' => 'We had trouble processing this voice note. Please record it again.', 'temporary_byte_size' => null, 'byte_size' => 0]);
            $fresh->voiceAnnotation()->whereIn('transcript_status', ['pending', 'processing'])->update(['transcript_status' => 'failed']);
            if ($reviewer !== null) {
                app(QuotaService::class)->releaseDirect($reviewer, $reserved);
            }

            return true;
        });
        if (! $won) {
            return;
        }
        $clean = true;
        foreach (SpeechAsset::voiceAssetCandidatePaths($this->temporaryPath, $candidatePath) as $path) {
            $clean = (! Storage::disk($asset->disk)->exists($path) || Storage::disk($asset->disk)->delete($path)) && $clean;
        }
        if ($clean) {
            SpeechAsset::query()->whereKey($asset->id)->where('temporary_path', $this->temporaryPath)->update(['temporary_path' => null, 'normalization_candidate_path' => null]);
        }
    }
}
