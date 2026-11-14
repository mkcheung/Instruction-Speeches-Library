<?php

namespace App\Jobs;

use App\Enums\TranscriptStatus;
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

    /**
     * Queue this attempt. If the queue rejects it, the attempt can never run,
     * so settle it as a retryable failure instead of leaving it pending forever
     * (compare-and-set: same annotation, asset and attempt, still pending),
     * then rethrow. Unlike markFailed(), a `processing` row is left alone.
     */
    public static function dispatchOrMarkFailed(int $annotationId, int $assetId, string $attemptId): void
    {
        try {
            self::dispatch($annotationId, $assetId, $attemptId); // PendingDispatch pushes at the end of this statement
        } catch (Throwable $exception) {
            Annotation::query()->whereKey($annotationId)->where('audio_asset_id', $assetId)
                ->where('transcript_attempt_id', $attemptId)->where('transcript_status', TranscriptStatus::Pending->value)
                ->update(['transcript_status' => TranscriptStatus::Failed->value, 'transcript_failure_code' => 'voice_transcription_failed']);
            throw $exception;
        }
    }

    public function handle(VoiceNoteTranscriberContract $transcriber): void
    {
        $annotation = Annotation::query()->with('audioAsset')->find($this->annotationId);
        if ($annotation === null || $annotation->audioAsset?->isReady() !== true || $annotation->transcript_status !== TranscriptStatus::Pending->value) {
            return;
        }
        $claimed = Annotation::query()->whereKey($annotation->id)->where('audio_asset_id', $this->assetId)
            ->where('transcript_attempt_id', $this->attemptId)->where('transcript_status', TranscriptStatus::Pending->value)
            ->update(['transcript_status' => TranscriptStatus::Processing->value]);
        if ($claimed !== 1) {
            return;
        }

        try {
            $body = $transcriber->transcribe($annotation->audioAsset);
            DB::transaction(function () use ($annotation, $body): void {
                $fresh = Annotation::query()->whereKey($annotation->id)->lockForUpdate()->first();
                if ($fresh === null || $fresh->audio_asset_id !== $this->assetId || $fresh->transcript_attempt_id !== $this->attemptId || $fresh->transcript_status !== TranscriptStatus::Processing->value) {
                    return;
                }
                $fresh->update(['body' => $body, 'transcript_status' => TranscriptStatus::Ready->value, 'transcript_failure_code' => null, 'lock_version' => $fresh->lock_version + 1]);
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
            ->whereIn('transcript_status', TranscriptStatus::inFlight())
            ->update(['transcript_status' => TranscriptStatus::Failed->value, 'transcript_failure_code' => $code]);
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
