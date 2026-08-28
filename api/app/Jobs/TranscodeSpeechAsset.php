<?php

namespace App\Jobs;

use App\Models\SpeechAsset;
use App\Services\Transcoding\TranscoderContract;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * §9.2's non-negotiable #1: `after_commit => true`. Without it, this job
 * dispatched inside the upload-complete controller's `DB::transaction()`
 * can be picked up by the queue worker before that transaction commits —
 * "model not found" on the very asset the request just created. Setting it
 * on the job itself (rather than relying on the queue connection default)
 * means it holds regardless of which connection config is active.
 *
 * Never creates the asset row (§9.2's idempotency guarantee) — the
 * upload-complete controller action already created it `status=processing`
 * before dispatching; this only updates it.
 */
class TranscodeSpeechAsset implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Wall-clock ceiling for one attempt (§9.2). Must stay below the
     * `redis-long` connection's `retry_after => 3900` (config/queue.php) —
     * if this ever exceeded that, the queue could release a second worker
     * onto the same job while the first was still legitimately running,
     * i.e. two ffmpeg processes fighting over the same asset.
     */
    public int $timeout = 3600;

    /**
     * §9.2: a job that merely exceeds $timeout must be marked failed, not
     * silently retried into another 3600s attempt.
     */
    public bool $failOnTimeout = true;

    /**
     * `$connection` and `$queue` are set in the constructor below, not as
     * re-declared typed properties here: same reason as `$afterCommit`
     * (see the constructor's doc comment) — `Queueable` already declares
     * both as untyped properties, and a typed re-declaration in a class
     * using that trait is a fatal "incompatible property" error at
     * class-composition time (confirmed by actually hitting it while
     * writing this), not just a lint warning.
     */
    public function __construct(public int $speechAssetId)
    {
        $this->afterCommit = true;

        // Routes this job onto the long-retry_after connection (§9.2,
        // Task 3 above) without touching any dispatch call site elsewhere.
        $this->connection = 'redis-long';

        // Dedicated queue name — a dedicated worker process is pointed at
        // this literal, and the UI's backpressure signal reads
        // `Redis::llen('queues:transcode')` directly, so the string itself
        // is load-bearing and must not be renamed casually.
        $this->queue = 'transcode';
    }

    /**
     * A collision must be able to RETRY. `WithoutOverlapping` releases the
     * job back onto the queue, and a release increments the attempt count —
     * so with no `$tries` here the worker's `--tries=1` (compose.yaml)
     * applied, and the very next pop failed the job outright with
     * `MaxAttemptsExceededException`. One lock collision was therefore a
     * permanent failure, and with no `failed()` below the asset was left at
     * `processing` forever behind a Retry button that reproduced it.
     *
     * `$failOnTimeout` still holds §9.2's "a job that merely exceeds
     * $timeout must be marked failed, not silently retried" — that path
     * fails the job regardless of how many tries remain.
     */
    public int $tries = 3;

    /**
     * Keyed on asset id (§9.2) so a release/retry that races a still-running
     * attempt for the *same* asset can't let two workers transcode it at
     * once; a different asset id is a different lock and proceeds
     * unaffected.
     *
     * `shared()` is load-bearing: without it Laravel prefixes the lock key
     * with the JOB CLASS (`WithoutOverlapping::getLockKey` falls through to
     * `get_class($job)`), so this job and GeneratePoster took two DIFFERENT
     * locks on the same asset id and GeneratePoster's docblock claim that
     * "the two must never run at once" was not true. A single-replica
     * `ffmpeg-worker` masks that by serializing the queue, which is exactly
     * why the middleware is the only protection that matters here — it
     * exists solely for the scaled case.
     *
     * `releaseAfter(5)` rather than 0: an immediate re-release against a
     * lock held for the full `expireAfter` window just burns attempts, and
     * a lock leaked by a SIGKILL/OOM (the `finally` that releases it never
     * runs) is held for the full 3900s.
     *
     * @return array<int, WithoutOverlapping>
     */
    public function middleware(): array
    {
        return [
            (new WithoutOverlapping((string) $this->speechAssetId))
                ->shared()
                ->expireAfter(3900)
                ->releaseAfter(5),
        ];
    }

    /**
     * §9.2's visible-failure backstop, modeled on GenerateCaptions::failed().
     * Only moves a row that is still `processing`, so it is a safe no-op if
     * the asset already resolved or a newer attempt took it over.
     */
    public function failed(Throwable $exception): void
    {
        Log::error('TranscodeSpeechAsset: job failed with an unhandled exception.', [
            'speech_asset_id' => $this->speechAssetId,
            'exception' => $exception->getMessage(),
        ]);

        SpeechAsset::query()
            ->whereKey($this->speechAssetId)
            ->where('status', 'processing')
            ->update([
                'status' => 'failed',
                'failure_code' => 'job_failed',
                'failure_detail' => 'We had trouble processing this video. Please try again.',
            ]);
    }

    public function handle(TranscoderContract $transcoder): void
    {
        $asset = SpeechAsset::query()->find($this->speechAssetId);

        // Exit guard: the speech (and cascade-deleted asset) may be gone by
        // the time this runs. Nothing to transcode into.
        if ($asset === null || $asset->status !== 'processing') {
            return;
        }

        $transcoder->transcode($asset);
    }
}
