<?php

namespace App\Jobs;

use App\Models\Annotation;
use App\Services\Voice\VoiceNoteTranscriberContract;
use App\Services\Voice\VoiceTranscriptionException;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Process\Exceptions\ProcessTimedOutException;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\TimeoutExceededException;
use Illuminate\Support\Facades\DB;
use Throwable;

class TranscribeVoiceNote implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 1700;

    public int $tries = 1;

    public bool $failOnTimeout = true;

    public function __construct(public int $annotationId, public int $assetId, public string $attemptId)
    {
        $this->afterCommit = true;
        $this->connection = 'redis-long';
        $this->queue = 'captions';
    }

    public function handle(VoiceNoteTranscriberContract $transcriber): void
    {
        $annotation = Annotation::query()->with('audioAsset')->find($this->annotationId);
        if ($annotation === null || $annotation->audioAsset?->status !== 'ready' || $annotation->transcript_status !== 'pending') {
            return;
        }
        $claimed = Annotation::query()->whereKey($annotation->id)->where('audio_asset_id', $this->assetId)
            ->where('transcript_attempt_id', $this->attemptId)->where('transcript_status', 'pending')
            ->update(['transcript_status' => 'processing']);
        if ($claimed !== 1) {
            return;
        }

        try {
            $body = $transcriber->transcribe($annotation->audioAsset);
            DB::transaction(function () use ($annotation, $body): void {
                $fresh = Annotation::query()->whereKey($annotation->id)->lockForUpdate()->first();
                if ($fresh === null || $fresh->audio_asset_id !== $this->assetId || $fresh->transcript_attempt_id !== $this->attemptId || $fresh->transcript_status !== 'processing') {
                    return;
                }
                $fresh->update(['body' => $body, 'transcript_status' => 'ready', 'transcript_failure_code' => null, 'lock_version' => $fresh->lock_version + 1]);
            });
        } catch (Throwable $exception) {
            $this->markFailed($this->failureCode($exception));
        }
    }

    public function failed(Throwable $e): void
    {
        $this->markFailed($this->failureCode($e));
    }

    private function markFailed(string $code): void
    {
        Annotation::query()->whereKey($this->annotationId)->where('audio_asset_id', $this->assetId)->where('transcript_attempt_id', $this->attemptId)
            ->whereIn('transcript_status', ['pending', 'processing'])
            ->update(['transcript_status' => 'failed', 'transcript_failure_code' => $code]);
    }

    private function failureCode(Throwable $exception): string
    {
        if ($exception instanceof ProcessTimedOutException || $exception instanceof TimeoutExceededException) {
            return 'voice_transcription_timed_out';
        }
        if ($exception instanceof VoiceTranscriptionException) {
            return $exception->failureCode;
        }

        return 'voice_transcription_failed';
    }
}
