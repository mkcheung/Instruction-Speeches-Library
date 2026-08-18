<?php

use App\Exceptions\CaptionsDisabledException;
use App\Jobs\GenerateCaptions;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\Captions\EnsureCaptionJob;
use App\Services\Captions\WhisperTranscriber;
use Illuminate\Database\QueryException;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * captions-settings gap fix (post-STEP-09 code review): `PATCH
 * /speeches/{speech}/caption-settings` and its backing service,
 * App\Services\Captions\EnsureCaptionJob. Every `it()` below is named after
 * the exact row of the task brief's frozen state table it covers, so the
 * table and the test suite stay traceable to each other.
 */
function readySource(Speech $speech): SpeechAsset
{
    return SpeechAsset::factory()->for($speech)->create(['status' => 'ready']);
}

/**
 * A trimmed, locally-scoped copy of WhisperTranscriberTest.php's own
 * `fakeWhisper()` helper (success path only — this file only needs a
 * "whisper eventually finishes" stand-in, not its failure-mode variants).
 * Deliberately NOT reusing that file's global `fakeWhisper()` function:
 * top-level functions declared in one Pest test file are only guaranteed
 * defined once THAT file has been `require`d, and Pest does not promise a
 * load order across files — running this file in isolation
 * (`pest tests/Feature/Captions/CaptionSettingsTest.php`) hit exactly that
 * "Call to undefined function" failure before this local copy was added.
 */
function fakeWhisperSuccess(string $vttOutput): void
{
    Process::fake(function (PendingProcess $process) use ($vttOutput) {
        $command = $process->command;

        if (! is_array($command)) {
            return Process::result(output: '');
        }

        $bin = (string) $command[0];

        if ($bin === 'ffmpeg') {
            file_put_contents((string) end($command), 'wav-bytes');

            return Process::result(exitCode: 0);
        }

        if (str_contains($bin, 'whisper')) {
            $ofIndex = array_search('-of', $command, true);
            file_put_contents($command[$ofIndex + 1].'.vtt', $vttOutput);

            return Process::result(exitCode: 0);
        }

        return Process::result(output: '');
    });
}

// --- HTTP surface / RBAC -----------------------------------------------

it('a stranger cannot PATCH caption settings', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $this->actingAs($stranger)
        ->patchJson("/api/speeches/{$speech->id}/caption-settings", ['captions_enabled' => false])
        ->assertForbidden();
});

it('an accepted reviewer cannot PATCH caption settings', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->accepted()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    $this->actingAs($reviewer)
        ->patchJson("/api/speeches/{$speech->id}/caption-settings", ['captions_enabled' => false])
        ->assertForbidden();
});

it('rejects a missing or non-boolean captions_enabled with 422', function () {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $this->actingAs($owner)
        ->patchJson("/api/speeches/{$speech->id}/caption-settings", [])
        ->assertStatus(422);

    $this->actingAs($owner)
        ->patchJson("/api/speeches/{$speech->id}/caption-settings", ['captions_enabled' => 'nope'])
        ->assertStatus(422);
});

it('the owner can PATCH caption settings and gets the updated speech back', function () {
    Queue::fake();
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create(['captions_enabled' => true]);

    $response = $this->actingAs($owner)
        ->patchJson("/api/speeches/{$speech->id}/caption-settings", ['captions_enabled' => false]);

    $response->assertOk();
    $response->assertJsonPath('speech.captions_enabled', false);
    expect($speech->fresh()->captions_enabled)->toBeFalse();
});

// --- Table row 1: no ready source, no caption asset -> Enable -----------

it('table row 1: enabling with no ready source and no caption asset persists true and creates nothing', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => false]);

    (new EnsureCaptionJob)->enable($speech);

    expect($speech->fresh()->captions_enabled)->toBeTrue();
    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->exists())->toBeFalse();
    Queue::assertNotPushed(GenerateCaptions::class);
});

// --- Table row 2: no ready source, existing failed asset -> Enable ------

it('table row 2: re-enabling with no ready source retains the failed row and dispatches nothing', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => false]);
    $failed = SpeechAsset::factory()->for($speech)->captions()->failed('transcription_failed')->create();

    (new EnsureCaptionJob)->enable($speech);

    expect($speech->fresh()->captions_enabled)->toBeTrue();
    $fresh = $failed->fresh();
    expect($fresh->status)->toBe('failed');
    expect($fresh->failure_code)->toBe('transcription_failed');
    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->count())->toBe(1);
    Queue::assertNotPushed(GenerateCaptions::class);
});

// --- Table row 3: ready source, no/failed asset -> Enable ---------------

it('table row 3a: enabling with a ready source and no asset creates exactly one processing row and dispatches once', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => false]);
    readySource($speech);

    (new EnsureCaptionJob)->enable($speech);

    $asset = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->sole();
    expect($asset->status)->toBe('processing');
    Queue::assertPushed(GenerateCaptions::class, fn ($job) => $job->captionsAssetId === $asset->id);
    Queue::assertPushed(GenerateCaptions::class, 1);
});

it('table row 3b (also the re-enable row): enabling with a ready source and a failed asset reuses the row, clears failure fields, marks processing, dispatches once', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => false]);
    readySource($speech);
    $failed = SpeechAsset::factory()->for($speech)->captions()->failed('captions_disabled')->create();

    (new EnsureCaptionJob)->enable($speech);

    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->count())->toBe(1);
    $fresh = $failed->fresh();
    expect($fresh->id)->toBe($failed->id); // reused, not a new row
    expect($fresh->status)->toBe('processing');
    expect($fresh->failure_code)->toBeNull();
    expect($fresh->failure_detail)->toBeNull();
    Queue::assertPushed(GenerateCaptions::class, fn ($job) => $job->captionsAssetId === $fresh->id);
    Queue::assertPushed(GenerateCaptions::class, 1);
});

// --- Table row 4: processing/ready -> Enable is an idempotent no-op -----

it('table row 4a: enabling a speech already processing captions is an idempotent no-op', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    readySource($speech);
    $processing = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'processing']);

    (new EnsureCaptionJob)->enable($speech);

    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->count())->toBe(1);
    expect($processing->fresh()->status)->toBe('processing');
    Queue::assertNotPushed(GenerateCaptions::class);
});

it('table row 4b: enabling a speech with ready captions is an idempotent no-op', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    readySource($speech);
    $ready = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'ready']);

    (new EnsureCaptionJob)->enable($speech);

    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->count())->toBe(1);
    expect($ready->fresh()->status)->toBe('ready');
    Queue::assertNotPushed(GenerateCaptions::class);
});

// --- Table row 5: no asset or failed -> Disable --------------------------

it('table row 5a: disabling with no caption asset persists false and dispatches nothing', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => true]);

    (new EnsureCaptionJob)->disable($speech);

    expect($speech->fresh()->captions_enabled)->toBeFalse();
    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->exists())->toBeFalse();
    Queue::assertNotPushed(GenerateCaptions::class);
});

it('table row 5b: disabling with a failed asset persists false and retains the failure history', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    $failed = SpeechAsset::factory()->for($speech)->captions()->failed('transcription_failed')->create();

    (new EnsureCaptionJob)->disable($speech);

    expect($speech->fresh()->captions_enabled)->toBeFalse();
    $fresh = $failed->fresh();
    expect($fresh->status)->toBe('failed');
    expect($fresh->failure_code)->toBe('transcription_failed');
    Queue::assertNotPushed(GenerateCaptions::class);
});

// --- Table row 6: processing -> Disable ----------------------------------

it('table row 6: disabling a processing captions asset atomically persists false and moves the attempt to failed/captions_disabled', function () {
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    $processing = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'processing']);

    (new EnsureCaptionJob)->disable($speech);

    expect($speech->fresh()->captions_enabled)->toBeFalse();
    $fresh = $processing->fresh();
    expect($fresh->status)->toBe('failed');
    expect($fresh->failure_code)->toBe('captions_disabled');
});

/**
 * The in-flight-worker race: WhisperTranscriber::transcribe()'s guarded
 * write only publishes `ready` if the row is STILL `processing` under its
 * own `lockForUpdate()`. Simulated sequentially (same convention
 * WhisperTranscriberTest's own "does not clobber a speaker edit" test
 * uses) rather than real parallel processes: disable() runs and wins the
 * race first, so by the time the "worker" re-checks the row it must see
 * something other than `processing` and skip its write.
 */
it('table row 6 race: a disable that lands while a worker is "in flight" prevents that worker from ever publishing ready', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create(['captions_enabled' => true]);
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId,
    ]);

    // The disable "wins the race" — lands before the worker's own guarded
    // write acquires the lock, and (§4.1) invalidates the attempt token
    // the "worker" below is still holding.
    (new EnsureCaptionJob)->disable($speech);
    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('captions_disabled');
    expect($captions->fresh()->caption_attempt_id)->toBeNull();

    fakeWhisperSuccess("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nStale, too late.");
    (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

    // The worker's guard (`status !== 'processing'`) saw `failed`, not
    // `processing`, and skipped its write entirely — the disable's
    // `captions_disabled` failure state survives untouched.
    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('captions_disabled');
});

// --- Table row 7: ready -> Disable ---------------------------------------

it('table row 7: disabling a ready captions asset persists false only and keeps serving the ready VTT', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    $ready = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($ready->path, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi.");

    (new EnsureCaptionJob)->disable($speech);

    expect($speech->fresh()->captions_enabled)->toBeFalse();
    $fresh = $ready->fresh();
    expect($fresh->status)->toBe('ready');
    Storage::disk('media')->assertExists($fresh->path);
});

it('table row 7 (manual edit remains allowed while disabled): the owner can still PUT captions after disabling automation', function () {
    Queue::fake();
    Storage::fake('media');
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create(['captions_enabled' => true]);
    $ready = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($ready->path, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOld.");

    (new EnsureCaptionJob)->disable($speech);

    $newVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHand-edited while off.";
    $response = $this->actingAs($owner)->putJson("/api/speeches/{$speech->id}/captions", ['vtt' => $newVtt]);

    $response->assertOk();
    $response->assertJsonPath('captions.status', 'ready');
    expect(Storage::disk('media')->get($ready->fresh()->path))->toBe($newVtt);
});

// --- Table row 8: any disabled state -> Retry ----------------------------

it('table row 8: retrying automatic generation while captions are disabled returns 409 captions_disabled and never re-enables', function () {
    Queue::fake();
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create(['captions_enabled' => false]);
    $failed = SpeechAsset::factory()->for($speech)->captions()->failed('captions_disabled')->create();

    $response = $this->actingAs($owner)->postJson("/api/speeches/{$speech->id}/assets/{$failed->id}/retry");

    $response->assertStatus(409);
    $response->assertJsonPath('code', 'captions_disabled');
    expect($speech->fresh()->captions_enabled)->toBeFalse();
    expect($failed->fresh()->status)->toBe('failed');
    Queue::assertNotPushed(GenerateCaptions::class);
});

it('table row 8 (service level): EnsureCaptionJob::retryAutomatic throws CaptionsDisabledException without touching the row', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => false]);
    $failed = SpeechAsset::factory()->for($speech)->captions()->failed('captions_disabled')->create();

    expect(fn () => (new EnsureCaptionJob)->retryAutomatic($speech, $failed))
        ->toThrow(CaptionsDisabledException::class);

    expect($failed->fresh()->status)->toBe('failed');
    Queue::assertNotPushed(GenerateCaptions::class);
});

// --- Table row 9: failed/captions_disabled with ready source -> Re-enable

it('table row 9: re-enabling a failed/captions_disabled asset with a ready source reuses the row, clears failure fields, marks processing, dispatches once', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => false]);
    readySource($speech);
    $failed = SpeechAsset::factory()->for($speech)->captions()->failed('captions_disabled')->create();

    (new EnsureCaptionJob)->enable($speech);

    $fresh = $failed->fresh();
    expect($fresh->id)->toBe($failed->id);
    expect($fresh->status)->toBe('processing');
    expect($fresh->failure_code)->toBeNull();
    Queue::assertPushed(GenerateCaptions::class, 1);
});

// --- Uniqueness constraint ------------------------------------------------

it('the DB rejects a second captions row for the same speech', function () {
    $speech = Speech::factory()->create();
    SpeechAsset::factory()->for($speech)->captions()->create();

    expect(fn () => SpeechAsset::factory()->for($speech)->captions()->create())
        ->toThrow(QueryException::class);
});

// --- Concurrency: enable/upload/retry converge safely --------------------

/**
 * Simulated sequentially within one test (same convention as the race test
 * above and WhisperTranscriberTest's own), not real parallel processes —
 * each call still takes its own `DB::transaction()`/`lockForUpdate()`, so
 * this exercises the actual locking path, just without real thread
 * interleaving.
 */
it('concurrent enable calls converge on exactly one processing row and one dispatched job', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => false]);
    readySource($speech);

    $service = new EnsureCaptionJob;
    $service->enable($speech);
    $service->enable($speech->fresh()); // a second "concurrent" caller

    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->count())->toBe(1);
    Queue::assertPushed(GenerateCaptions::class, 1);
});

it('an upload completing concurrently with an enable never creates two captions rows', function () {
    Queue::fake();
    $speech = Speech::factory()->create(['captions_enabled' => true]);
    readySource($speech);

    $service = new EnsureCaptionJob;
    $service->enable($speech->fresh());
    $viaEnable = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->firstOrFail();
    $viaUpload = $service->ensureForUpload($speech->fresh());

    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->count())->toBe(1);
    expect($viaUpload->id)->toBe($viaEnable->id);
    Queue::assertPushed(GenerateCaptions::class, 1);
});
