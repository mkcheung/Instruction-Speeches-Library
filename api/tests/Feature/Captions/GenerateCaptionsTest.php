<?php

use App\Jobs\GenerateCaptions;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\CaptionTranscriberContract;
use App\Services\Captions\FakeCaptionTranscriber;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-captions.md / the frozen STEP-09 backend contract §6, §8.
 * `CaptionTranscriberContract` resolves to `FakeCaptionTranscriber` in the
 * testing environment (App\Providers\AppServiceProvider), mirroring
 * TranscoderContract's Fake/Ffmpeg split — these tests exercise the job's
 * own wiring/guards, not whisper.cpp itself.
 */
it('transcribes via the bound contract and marks the captions asset ready', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create(['captions_enabled' => true]);
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']); // source
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing']);

    (new GenerateCaptions($captions->id))->handle(app(CaptionTranscriberContract::class));

    expect($captions->fresh()->status)->toBe('ready');
    Storage::disk('media')->assertExists($captions->fresh()->path);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->source)->toBe('whisper');
    expect($transcript->model)->toBe('fake');
    expect($transcript->word_count)->toBeGreaterThan(0);
    expect($transcript->segments)->toHaveCount(2);
});

it('is a no-op if the captions asset is not in processing status', function () {
    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'ready']);

    (new GenerateCaptions($captions->id))->handle(new FakeCaptionTranscriber);

    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('is a no-op if the captions asset no longer exists', function () {
    (new GenerateCaptions(999_999))->handle(new FakeCaptionTranscriber);

    expect(SpeechTranscript::query()->count())->toBe(0);
});

it('fails the captions asset (defense in depth), not stays stuck processing, when captions_enabled has been toggled off since dispatch', function () {
    $speech = Speech::factory()->create(['captions_enabled' => false]);
    SpeechAsset::factory()->for($speech)->create(['status' => 'ready']);
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'processing']);

    (new GenerateCaptions($captions->id))->handle(new FakeCaptionTranscriber);

    // Must resolve to a terminal, retryable state — a silent no-op here
    // would leave the row stuck at `processing` forever, since retry()
    // only re-dispatches a `failed` asset.
    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('captions_disabled');
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('fails the captions asset independently when no source asset exists, without touching a video asset', function () {
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    $video = SpeechAsset::factory()->for($speech)->video()->ready()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'processing']);

    (new GenerateCaptions($captions->id))->handle(new FakeCaptionTranscriber);

    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('source_missing');
    // Independent per-asset failure (§8 of the contract): the video asset's
    // own status is untouched by a captions failure.
    expect($video->fresh()->status)->toBe('ready');
});
