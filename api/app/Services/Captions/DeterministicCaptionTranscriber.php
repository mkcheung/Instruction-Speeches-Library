<?php

namespace App\Services\Captions;

use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-VERIFICATION-PLAN.md §3.1/§4.2 point 3: the `caption-test-worker`
 * compose service's binding — never Whisper, never FakeCaptionTranscriber
 * (which completes instantly with no control). Bound only when
 * `CAPTION_TEST_WORKER=1` under `APP_ENV=e2e|testing`
 * (App\Providers\AppServiceProvider enforces the env gate; this class
 * doesn't re-check it).
 *
 * Protocol (a bash script drives this via `redis-cli`/`docker compose
 * exec`, not just Pest — the worker-isolation/old-attempt-race scripts
 * this exists for):
 *
 *   - `caption-test-worker:release:{attemptId}` — ABSENT means this
 *     attempt is held; a script `SET`s it (any value) to let the attempt
 *     proceed. Held-by-default (no separate hold key) so "enqueue work,
 *     start this worker, assert it's still processing" needs no setup
 *     step before the hold takes effect.
 *   - `caption-test-worker:status:{attemptId}` — this class's own
 *     progress marker a script polls instead of racing log output:
 *     `held` while waiting, `processing` once released and writing,
 *     `ready`/`failed`/`timed_out` terminal. All keys carry a 3600s TTL
 *     so a killed stack doesn't leak them into the next run.
 *
 * All keys go through the SAME `default` Redis/Valkey connection
 * `App\Http\Controllers\Api\QueueStatusController` already uses
 * (`redis-long`'s own queue connection — config/queue.php) — no new
 * connection — namespaced under the `caption-test-worker:` prefix so
 * these can never collide with cache/queue keys.
 */
class DeterministicCaptionTranscriber implements CaptionTranscriberContract
{
    private const FAKE_VTT = <<<'VTT'
        WEBVTT

        00:00:00.000 --> 00:00:02.000
        This is a deterministic test transcript.

        00:00:02.000 --> 00:00:04.000
        Held and released by caption-test-worker controls.
        VTT;

    private const MAX_WAIT_SECONDS = 120;

    private const POLL_MICROSECONDS = 250_000;

    private const KEY_TTL_SECONDS = 3600;

    /**
     * `$maxWaitSeconds`/`$pollMicroseconds` default to the constants above
     * for every real caller (AppServiceProvider's binding never overrides
     * them) — overridable only so DeterministicCaptionTranscriberTest can
     * exercise the timeout-and-fail branch in well under a second instead
     * of the real 120s ceiling.
     */
    public function __construct(
        private readonly TranscriptDeriver $deriver = new TranscriptDeriver,
        private readonly int $maxWaitSeconds = self::MAX_WAIT_SECONDS,
        private readonly int $pollMicroseconds = self::POLL_MICROSECONDS,
    ) {}

    public function transcribe(SpeechAsset $sourceAsset, SpeechAsset $captionsAsset, string $attemptId): void
    {
        $this->setStatus($attemptId, 'held');

        $waitedMicroseconds = 0;

        while (! Redis::connection()->get($this->key('release', $attemptId))) {
            if ($waitedMicroseconds >= $this->maxWaitSeconds * 1_000_000) {
                $this->setStatus($attemptId, 'timed_out');
                $this->fail($captionsAsset, $attemptId, 'transcription_failed', 'We had trouble captioning this speech. Please try again.');

                return;
            }

            // §4.1's stage-boundary heartbeat, same as WhisperTranscriber:
            // the wait itself can legitimately run for up to
            // $maxWaitSeconds, and the recovery reconciler's stale clock
            // (4200s default) must see this attempt as alive, not stuck.
            CaptionAttemptTracker::heartbeat($captionsAsset->id, $attemptId);

            usleep($this->pollMicroseconds);
            $waitedMicroseconds += $this->pollMicroseconds;
        }

        $this->setStatus($attemptId, 'processing');
        CaptionAttemptTracker::heartbeat($captionsAsset->id, $attemptId);

        $cues = Vtt::parse(self::FAKE_VTT);
        $derived = $this->deriver->derive($cues);

        // Same guarded compare-and-set shape as WhisperTranscriber — the
        // whole reason this class exists is to let the old-attempt-race
        // script observe this exact guard resolve a real race, not to
        // take a shortcut around it the way FakeCaptionTranscriber does.
        $wrote = DB::transaction(function () use ($captionsAsset, $attemptId): bool {
            /** @var SpeechAsset|null $fresh */
            $fresh = SpeechAsset::query()->whereKey($captionsAsset->id)->lockForUpdate()->first();

            if ($fresh === null || $fresh->status !== 'processing' || $fresh->caption_attempt_id !== $attemptId) {
                return false;
            }

            if (! Storage::disk($fresh->disk)->put($fresh->path, self::FAKE_VTT)) {
                throw new CaptionStorageWriteException("Failed writing VTT to disk for caption asset {$fresh->id}.");
            }

            $fresh->update([
                'status' => 'ready',
                'byte_size' => strlen(self::FAKE_VTT),
                'content_revision' => CaptionRevision::compute(self::FAKE_VTT),
            ]);

            return true;
        });

        if (! $wrote) {
            $this->setStatus($attemptId, 'superseded');

            return;
        }

        SpeechTranscript::query()->updateOrCreate(
            ['speech_id' => $captionsAsset->speech_id],
            [
                ...$derived,
                'language' => 'en',
                'model' => 'caption-test-worker',
                'source' => 'whisper',
                'caption_revision' => CaptionRevision::compute(self::FAKE_VTT),
            ],
        );

        $this->setStatus($attemptId, 'ready');
    }

    private function fail(SpeechAsset $captionsAsset, string $attemptId, string $code, string $detail): void
    {
        DB::transaction(function () use ($captionsAsset, $attemptId, $code, $detail) {
            /** @var SpeechAsset|null $fresh */
            $fresh = SpeechAsset::query()->whereKey($captionsAsset->id)->lockForUpdate()->first();

            if ($fresh === null || $fresh->status !== 'processing' || $fresh->caption_attempt_id !== $attemptId) {
                return;
            }

            $fresh->update([
                'status' => 'failed',
                'failure_code' => $code,
                'failure_detail' => $detail,
            ]);
        });
    }

    private function setStatus(string $attemptId, string $status): void
    {
        Redis::connection()->setex($this->key('status', $attemptId), self::KEY_TTL_SECONDS, $status);
    }

    private function key(string $segment, string $attemptId): string
    {
        return "caption-test-worker:{$segment}:{$attemptId}";
    }
}
