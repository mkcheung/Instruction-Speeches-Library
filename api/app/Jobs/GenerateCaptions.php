<?php

namespace App\Jobs;

use App\Models\SpeechAsset;
use App\Services\Captions\CaptionAttemptTracker;
use App\Services\Captions\CaptionTranscriberContract;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * STEP-09-captions.md / the frozen backend contract §6, §8. Modeled
 * directly on App\Jobs\TranscodeSpeechAsset: same `afterCommit` reasoning
 * (dispatched from inside SpeechUploadController::complete's
 * `DB::transaction()`, alongside TranscodeSpeechAsset — a worker must not
 * pick this up before that transaction commits), same "the request
 * creates the row, the job only updates it" idempotency rule, same
 * never-throw contract (App\Services\Captions\CaptionTranscriberContract
 * implementations write a `failed` status themselves).
 *
 * R11's whole point lives in the constructor below: `redis-long`/
 * `--queue=captions` is a DIFFERENT queue name from TranscodeSpeechAsset's
 * `transcode`, so a dedicated `whisper-worker` process (compose.yaml)
 * drains this one — a five-minute whisper.cpp run can never sit in front
 * of a two-second remux waiting on the SAME worker/queue.
 */
class GenerateCaptions implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Below `redis-long`'s `retry_after => 3900`, same ordering
     * TranscodeSpeechAsset's own `$timeout` keeps against the same
     * connection, for the same reason (a second worker must never be
     * released onto this asset while the first whisper.cpp process is
     * still legitimately running).
     */
    public int $timeout = 3600;

    public bool $failOnTimeout = true;

    /**
     * `$connection`/`$queue` set in the constructor, not as re-declared
     * typed properties — `Queueable` already declares both untyped, and a
     * typed re-declaration is a fatal "incompatible property" error (see
     * TranscodeSpeechAsset's own constructor doc comment, which hit this
     * first).
     */
    public function __construct(public int $captionsAssetId, public string $attemptId)
    {
        $this->afterCommit = true;
        $this->connection = 'redis-long';

        // A NEW queue name on the EXISTING `redis-long` connection (the
        // frozen contract §6 is explicit that no new Redis connection is
        // needed) — this literal string is load-bearing: the
        // `whisper-worker` compose service's `queue:work` command names it
        // exactly, and it is what keeps caption processing off the
        // `transcode` queue entirely (R11).
        $this->queue = 'captions';
    }

    // Deliberately no `WithoutOverlapping` middleware (STEP-09-VERIFICATION-
    // PLAN.md §4.1): the dedicated `whisper-worker` compose service already
    // runs at concurrency one, and `$attemptId` below — not job-level
    // mutual exclusion — is what keeps a superseded attempt from ever
    // publishing over a newer one, even if an operator later scales this
    // worker to more than one replica. Removing it also removes the old
    // failure mode where a collision would consume and discard the newest
    // queued attempt outright instead of just losing a race for the row.

    public function handle(CaptionTranscriberContract $transcriber): void
    {
        $captionsAsset = SpeechAsset::query()->find($this->captionsAssetId);

        // Exit guard: the row may have moved on (already ready/failed from
        // a previous attempt, or a disable -> re-enable rotated a NEWER
        // attempt id onto this same row) or the speech may be gone
        // entirely by the time this runs. Comparing `caption_attempt_id`
        // here — not just `status` — is what makes an old attempt A a
        // guaranteed no-op once a disable/edit/re-enable has superseded it,
        // even though A's own status read of 'processing' briefly looked
        // identical to a genuinely current job.
        if ($captionsAsset === null || $captionsAsset->status !== 'processing' || $captionsAsset->caption_attempt_id !== $this->attemptId) {
            return;
        }

        // Atomic compare-and-set claim: only this exact token, on a row
        // still `processing`, gets to record `started_at`/`heartbeat_at`
        // and proceed. Losing this race (0 rows updated) means some other
        // transaction — EnsureCaptionJob::disable(), a manual edit's
        // CaptionAttemptTracker::invalidate(), or a fresh re-enable's
        // rotate() — won the row between the read above and here.
        if (! CaptionAttemptTracker::claim($this->captionsAssetId, $this->attemptId)) {
            return;
        }

        $speech = $captionsAsset->speech;

        // Defense in depth against the off-switch (§20 Q12): the request
        // that dispatched this job already checked captions_enabled, but a
        // speaker can toggle it off between dispatch and a worker actually
        // picking this job up (or a retry re-dispatching it later).
        //
        // Must resolve to `failed`, not a silent no-op: the row was just
        // set to `processing` by the dispatcher (SpeechUploadController's
        // upload-complete path, or `retry()`), and nothing else will ever
        // move it off `processing` if this method returns without writing
        // a terminal status — the asset (and CaptionEditor's "Captions are
        // still processing..." UI) would be stuck forever, with no retry
        // affordance, since retry() only re-dispatches a `failed` asset.
        if ($speech === null || ! $speech->captions_enabled) {
            $this->markFailed('captions_disabled', 'Captions are turned off for this speech.');

            return;
        }

        $sourceAsset = $speech->assets()->where('kind', 'source')->first();

        if ($sourceAsset === null) {
            // Independent per-asset failure (§8 of the contract, mirroring
            // STEP-04's poster pipeline): this asset's own `failed` status,
            // never touching the video asset's status.
            $this->markFailed('source_missing', 'No source asset found for this speech.');

            return;
        }

        $transcriber->transcribe($sourceAsset, $captionsAsset, $this->attemptId);
    }

    /**
     * Every terminal write this job makes to its own row (other than the
     * transcriber's own success/failure writes, which take the same
     * compare-and-set shape independently) is guarded by BOTH `status =
     * 'processing'` and `caption_attempt_id = $this->attemptId` — never
     * just the first.
     */
    private function markFailed(string $code, string $detail): void
    {
        SpeechAsset::query()
            ->whereKey($this->captionsAssetId)
            ->where('status', 'processing')
            ->where('caption_attempt_id', $this->attemptId)
            ->update([
                'status' => 'failed',
                'failure_code' => $code,
                'failure_detail' => $detail,
            ]);
    }

    /**
     * Backstop for an unhandled exception during `handle()` itself (a
     * `CaptionTranscriberContract` implementation is contractually
     * never-throw per the class docblock above, but this job's own body —
     * the guard clauses, `$captionsAsset->update()` calls — is not, and a
     * queue worker OOM/timeout or any other unhandled exception must not
     * leave the row stuck at `processing` forever with no retry
     * affordance). Same guarded-write shape as WhisperTranscriber::fail():
     * only moves a row that is still `processing` to `failed`, so this is
     * a no-op (and safe to call more than once) if the asset already
     * resolved to a terminal state or moved on since this job started.
     */
    public function failed(Throwable $e): void
    {
        Log::error('GenerateCaptions: job failed with an unhandled exception.', [
            'caption_asset_id' => $this->captionsAssetId,
            'exception' => $e->getMessage(),
        ]);

        SpeechAsset::query()
            ->whereKey($this->captionsAssetId)
            ->where('status', 'processing')
            ->where('caption_attempt_id', $this->attemptId)
            ->update([
                'status' => 'failed',
                'failure_code' => 'job_failed',
                // User-safe: no exception message/stack trace/paths, same
                // "safe, generic detail" convention the transcriber's own
                // fail() strings use.
                'failure_detail' => 'We had trouble captioning this speech. Please try again.',
            ]);
    }
}
