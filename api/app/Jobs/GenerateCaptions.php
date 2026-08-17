<?php

namespace App\Jobs;

use App\Models\SpeechAsset;
use App\Services\Captions\CaptionTranscriberContract;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;

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
    public function __construct(public int $captionsAssetId)
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

    /**
     * Keyed on the captions asset id, same shape as TranscodeSpeechAsset's
     * own middleware (keyed on the video asset id) — a release/retry
     * racing a still-running attempt for the SAME captions asset can't let
     * two workers transcribe it at once.
     *
     * @return array<int, WithoutOverlapping>
     */
    public function middleware(): array
    {
        return [
            (new WithoutOverlapping((string) $this->captionsAssetId))
                ->expireAfter(3900)
                ->releaseAfter(0),
        ];
    }

    public function handle(CaptionTranscriberContract $transcriber): void
    {
        $captionsAsset = SpeechAsset::query()->find($this->captionsAssetId);

        // Exit guard, same spirit as TranscodeSpeechAsset's: the row may
        // have moved on (already ready/failed from a previous attempt) or
        // the speech may be gone entirely by the time this runs.
        if ($captionsAsset === null || $captionsAsset->status !== 'processing') {
            return;
        }

        $speech = $captionsAsset->speech;

        // Defense in depth against the off-switch (§20 Q12): the request
        // that dispatched this job already checked captions_enabled, but a
        // speaker can toggle it off between dispatch and a worker actually
        // picking this job up (or a retry re-dispatching it later).
        if ($speech === null || ! $speech->captions_enabled) {
            return;
        }

        $sourceAsset = $speech->assets()->where('kind', 'source')->first();

        if ($sourceAsset === null) {
            // Independent per-asset failure (§8 of the contract, mirroring
            // STEP-04's poster pipeline): this asset's own `failed` status,
            // never touching the video asset's status.
            $captionsAsset->update([
                'status' => 'failed',
                'failure_code' => 'source_missing',
                'failure_detail' => 'No source asset found for this speech.',
            ]);

            return;
        }

        $transcriber->transcribe($sourceAsset, $captionsAsset);
    }
}
