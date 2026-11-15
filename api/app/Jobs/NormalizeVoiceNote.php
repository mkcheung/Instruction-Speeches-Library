<?php

namespace App\Jobs;

use App\Models\SpeechAsset;
use App\Services\Voice\FailVoiceNormalization;
use App\Services\Voice\VoiceNoteProcessorContract;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
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
            TranscribeVoiceNote::dispatchOrMarkFailed((int) $annotationId, $asset->id, $attemptId);
        }
    }

    public function failed(Throwable $exception): void
    {
        app(FailVoiceNormalization::class)->execute($this->assetId, $this->temporaryPath, 'voice_normalization_failed');
    }
}
