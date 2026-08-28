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

/**
 * §9.5's "let the speaker choose a frame" / sprite-picker affordance:
 * regenerates JUST the poster set for an already-`ready` video asset,
 * either at the automatic seek (`$explicitTimeSeconds === null`) or a
 * chosen frame. Never repeats the sprite pass — that's a transcode-time-
 * only, one-shot artifact (it doesn't depend on which frame is chosen).
 *
 * Modeled directly on TranscodeSpeechAsset: same `afterCommit`/
 * `redis-long`/`transcode` wiring, for the same reason (§9.2's
 * after_commit non-negotiable — a job dispatched inside the same
 * DB::transaction() as the request that created its target row must not
 * be picked up before that transaction commits).
 */
class GeneratePoster implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Poster generation is sub-second-to-seconds work (§9.5), nowhere near
     * TranscodeSpeechAsset's 3600s budget — but still bounded, and still
     * below `redis-long`'s `retry_after => 3900` for the same reason
     * TranscodeSpeechAsset's $timeout is.
     */
    public int $timeout = 120;

    public bool $failOnTimeout = true;

    /**
     * `$connection`/`$queue` are set here, not as re-declared typed
     * properties: `Queueable` already declares both as untyped properties,
     * and a typed re-declaration in a class using that trait is a fatal
     * "incompatible property" error at class-composition time — see
     * TranscodeSpeechAsset's constructor doc comment, which documents
     * hitting this exact trap first.
     */
    public function __construct(public int $videoAssetId, public ?float $explicitTimeSeconds)
    {
        $this->afterCommit = true;
        $this->connection = 'redis-long';
        $this->queue = 'transcode';
    }

    /**
     * A release increments the attempt count, so without `$tries` the
     * worker's `--tries=1` made a single lock collision a permanent
     * failure on the very next pop. Posters have no visible failed state
     * (§9.5), so that surfaced as nothing at all — the speaker's chosen
     * frame silently never applied. See TranscodeSpeechAsset::$tries.
     */
    public int $tries = 3;

    /**
     * Deliberately keyed on the SAME id space TranscodeSpeechAsset uses
     * (the video asset id) — a poster regeneration reads the rendition a
     * concurrent full transcode of that same asset would be rewriting, so
     * the two must never run at once.
     *
     * `shared()` is what actually makes that true. Laravel prefixes the
     * lock key with the job class unless it is set
     * (`WithoutOverlapping::getLockKey`), so this middleware and
     * TranscodeSpeechAsset's took two different locks on the same id and
     * the mutual exclusion this comment describes never existed.
     *
     * @return array<int, WithoutOverlapping>
     */
    public function middleware(): array
    {
        return [
            (new WithoutOverlapping((string) $this->videoAssetId))
                ->shared()
                ->expireAfter(3900)
                ->releaseAfter(5),
        ];
    }

    public function handle(TranscoderContract $transcoder): void
    {
        $asset = SpeechAsset::query()->find($this->videoAssetId);

        // Entry guard: posters can only be (re)generated for an
        // already-transcoded video — unlike TranscodeSpeechAsset's
        // `processing` guard, this job requires `ready`.
        if ($asset === null || $asset->status !== 'ready') {
            return;
        }

        $transcoder->generatePoster($asset, $this->explicitTimeSeconds);
    }
}
