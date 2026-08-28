<?php

use App\Jobs\GeneratePoster;
use App\Jobs\TranscodeSpeechAsset;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\Transcoding\TranscoderContract;

/**
 * §9.2 non-negotiable #1: `after_commit`. Laravel's own testing transaction
 * (RefreshDatabase) never truly commits, so exercising the real
 * dispatch-then-run timing isn't meaningful here (see UploadFlowTest, which
 * asserts the dispatch itself via Queue::fake()). What's tested directly:
 * the property is actually set, and handle()'s exit guard / delegation to
 * TranscoderContract (FakeTranscoder in testing — see AppServiceProvider).
 */
it('sets afterCommit so a dispatch inside the upload transaction is deferred correctly', function () {
    expect((new TranscodeSpeechAsset(1))->afterCommit)->toBeTrue();
});

it('marks the video asset ready via the bound TranscoderContract (FakeTranscoder in testing)', function () {
    $speech = Speech::factory()->create();
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    (new TranscodeSpeechAsset($video->id))->handle(app(TranscoderContract::class));

    expect($video->fresh()->status)->toBe('ready');
});

it('exits without effect if the asset is gone or no longer processing (idempotency exit guard, §9.2)', function () {
    $speech = Speech::factory()->create();
    $video = SpeechAsset::factory()->for($speech)->video()->ready()->create();

    // Already ready — must not be touched again.
    (new TranscodeSpeechAsset($video->id))->handle(app(TranscoderContract::class));
    expect($video->fresh()->status)->toBe('ready');

    // Deleted mid-flight — must not throw.
    (new TranscodeSpeechAsset(999_999))->handle(app(TranscoderContract::class));
});

/**
 * Post-STEP-10 code review: the overlap-lock and retry gaps. These two are
 * one finding, not two — sharing the lock without making a collision
 * retryable would have turned every newly-detected collision into an
 * instant permanent failure.
 */
it('shares one overlap lock with GeneratePoster for the same asset id', function () {
    $transcodeJob = new TranscodeSpeechAsset(42);
    $posterJob = new GeneratePoster(42, null);

    // `WithoutOverlapping::getLockKey()` prefixes the key with the job
    // class unless `shared()` is set, so these were two DIFFERENT locks and
    // GeneratePoster's "the two must never run at once" docblock did not
    // hold. A single-replica ffmpeg-worker masked it by serializing the
    // queue; the middleware exists only for the scaled case.
    expect($transcodeJob->middleware()[0]->getLockKey($transcodeJob))
        ->toBe($posterJob->middleware()[0]->getLockKey($posterJob));
});

it('keys the overlap lock per asset, so different assets never block each other', function () {
    $one = new TranscodeSpeechAsset(1);
    $two = new TranscodeSpeechAsset(2);

    expect($one->middleware()[0]->getLockKey($one))
        ->not->toBe($two->middleware()[0]->getLockKey($two));
});

it('allows more than one attempt, so a lock collision is retried rather than failed outright', function () {
    // A `WithoutOverlapping` release increments the attempt count. With no
    // $tries the worker's `--tries=1` applied, so the next pop raised
    // MaxAttemptsExceededException — one collision was a permanent failure.
    expect((new TranscodeSpeechAsset(1))->tries)->toBeGreaterThan(1);
    expect((new GeneratePoster(1, null))->tries)->toBeGreaterThan(1);
});

it('marks a stranded processing asset failed when the job exhausts its tries', function () {
    $speech = Speech::factory()->create();
    $asset = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    (new TranscodeSpeechAsset($asset->id))->failed(new RuntimeException('worker OOM'));

    // Without failed(), the asset sat at `processing` forever behind a
    // spinner and a Retry button that reproduced the same failure.
    expect($asset->fresh()->status)->toBe('failed');
    expect($asset->fresh()->failure_code)->toBe('job_failed');
});

it('leaves an already-resolved asset alone when a stale attempt fails', function () {
    $speech = Speech::factory()->create();
    $asset = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'ready']);

    (new TranscodeSpeechAsset($asset->id))->failed(new RuntimeException('stale attempt'));

    expect($asset->fresh()->status)->toBe('ready');
});
