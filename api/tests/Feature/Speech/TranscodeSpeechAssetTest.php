<?php

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
