<?php

use App\Jobs\GenerateCaptions;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\CaptionTranscriberContract;
use App\Services\Captions\FakeCaptionTranscriber;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * STEP-09-captions.md / the frozen STEP-09 backend contract §6, §8.
 * `CaptionTranscriberContract` resolves to `FakeCaptionTranscriber` in the
 * testing environment (App\Providers\AppServiceProvider), mirroring
 * TranscoderContract's Fake/Ffmpeg split — these tests exercise the job's
 * own wiring/guards, not whisper.cpp itself.
 *
 * STEP-09-VERIFICATION-PLAN.md §4.1: every fixture below carries a real
 * `caption_attempt_id` and the job is constructed with that SAME id, unless
 * a test is specifically exercising the attempt-token mismatch guard —
 * `GenerateCaptions` now no-ops on any row whose stored token doesn't match
 * the id it was dispatched with, exactly like a stale worker attempt would.
 */
it('transcribes via the bound contract and marks the captions asset ready', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create(['captions_enabled' => true]);
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']); // source
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId, 'caption_queued_at' => now(),
    ]);

    (new GenerateCaptions($captions->id, $attemptId))->handle(app(CaptionTranscriberContract::class));

    $fresh = $captions->fresh();
    expect($fresh->status)->toBe('ready');
    Storage::disk('media')->assertExists($fresh->path);

    // §4.1's claim() ran: started_at/heartbeat_at are now set, still on the
    // same attempt token — nothing invalidated it along the way.
    expect($fresh->caption_started_at)->not->toBeNull();
    expect($fresh->caption_heartbeat_at)->not->toBeNull();
    expect($fresh->caption_attempt_id)->toBe($attemptId);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->source)->toBe('whisper');
    expect($transcript->model)->toBe('fake');
    expect($transcript->word_count)->toBeGreaterThan(0);
    expect($transcript->segments)->toHaveCount(2);
});

it('is a no-op if the captions asset is not in processing status', function () {
    $speech = Speech::factory()->create();
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'ready', 'caption_attempt_id' => $attemptId]);

    (new GenerateCaptions($captions->id, $attemptId))->handle(new FakeCaptionTranscriber);

    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('is a no-op if the captions asset no longer exists', function () {
    (new GenerateCaptions(999_999, (string) Str::uuid()))->handle(new FakeCaptionTranscriber);

    expect(SpeechTranscript::query()->count())->toBe(0);
});

/**
 * §4.1's whole point: an old, still-queued/running attempt A must never be
 * able to act on a row a disable -> re-enable cycle has since rotated a
 * NEWER attempt B onto — even though, read naively, the row still says
 * `status = processing`, exactly as A itself left it.
 */
it('is a no-op when the stored attempt id no longer matches the one the job was dispatched with', function () {
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    SpeechAsset::factory()->for($speech)->create(['status' => 'ready']); // source
    $staleAttemptId = (string) Str::uuid();
    $currentAttemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'status' => 'processing', 'caption_attempt_id' => $currentAttemptId, 'caption_queued_at' => now(),
    ]);

    // Job A was dispatched with the stale id — as if it had been queued
    // before a disable -> re-enable cycle rotated the row onto attempt B.
    (new GenerateCaptions($captions->id, $staleAttemptId))->handle(new FakeCaptionTranscriber);

    $fresh = $captions->fresh();
    expect($fresh->status)->toBe('processing'); // untouched — B is still authoritative
    expect($fresh->caption_attempt_id)->toBe($currentAttemptId);
    expect($fresh->caption_started_at)->toBeNull(); // A never claimed the row
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('fails the captions asset (defense in depth), not stays stuck processing, when captions_enabled has been toggled off since dispatch', function () {
    $speech = Speech::factory()->create(['captions_enabled' => false]);
    SpeechAsset::factory()->for($speech)->create(['status' => 'ready']);
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'status' => 'processing', 'caption_attempt_id' => $attemptId, 'caption_queued_at' => now(),
    ]);

    (new GenerateCaptions($captions->id, $attemptId))->handle(new FakeCaptionTranscriber);

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
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'status' => 'processing', 'caption_attempt_id' => $attemptId, 'caption_queued_at' => now(),
    ]);

    (new GenerateCaptions($captions->id, $attemptId))->handle(new FakeCaptionTranscriber);

    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('source_missing');
    // Independent per-asset failure (§8 of the contract): the video asset's
    // own status is untouched by a captions failure.
    expect($video->fresh()->status)->toBe('ready');
});

/**
 * Code-review finding: no `failed()` backstop meant an unhandled exception
 * during `handle()` (a worker OOM/timeout, or a bug in the job's own body
 * rather than the transcriber) left the row stuck at `processing` forever,
 * with no retry affordance since `retry()` only re-dispatches `failed`
 * assets.
 */
it('failed() transitions a processing captions asset to failed with a safe, generic detail', function () {
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'processing', 'caption_attempt_id' => $attemptId]);

    (new GenerateCaptions($captions->id, $attemptId))->failed(new Exception('leaky /var/www/secret/path stack trace detail'));

    $fresh = $captions->fresh();
    expect($fresh->status)->toBe('failed');
    expect($fresh->failure_code)->toBe('job_failed');
    expect($fresh->failure_detail)->not->toContain('/var/www');
    expect($fresh->failure_detail)->not->toContain('secret');
});

it('failed() is a no-op when the attempt id no longer matches (superseded by disable/re-enable)', function () {
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    $staleAttemptId = (string) Str::uuid();
    $currentAttemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'status' => 'processing', 'caption_attempt_id' => $currentAttemptId,
    ]);

    (new GenerateCaptions($captions->id, $staleAttemptId))->failed(new Exception('boom'));

    $fresh = $captions->fresh();
    expect($fresh->status)->toBe('processing');
    expect($fresh->caption_attempt_id)->toBe($currentAttemptId);
});

it('failed() is a no-op when the captions asset is already in a terminal state', function () {
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'status' => 'ready', 'failure_code' => null, 'failure_detail' => null, 'caption_attempt_id' => $attemptId,
    ]);

    (new GenerateCaptions($captions->id, $attemptId))->failed(new Exception('boom'));

    expect($captions->fresh()->status)->toBe('ready');
    expect($captions->fresh()->failure_code)->toBeNull();
});

it('failed() is a no-op when the captions asset no longer exists', function () {
    (new GenerateCaptions(999_999, (string) Str::uuid()))->failed(new Exception('boom'));

    expect(SpeechAsset::query()->count())->toBe(0);
});
