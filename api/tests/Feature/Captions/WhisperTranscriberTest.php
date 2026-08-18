<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\WhisperTranscriber;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * `Process::fake()` stands in for `ffmpeg` (audio extraction) and
 * `whisper-cli` throughout, the same house style FfmpegTranscoderTest uses
 * for ffmpeg/ffprobe — no real whisper.cpp binary or GGUF model weights
 * are assumed present in this test environment (none are, in this
 * sandbox — see this task's final report for the explicit "unverified by
 * running a real binary" caveat).
 */
function fakeWhisper(string $vttOutput, bool $extractSucceeds = true, bool $whisperSucceeds = true): void
{
    Process::fake(function (PendingProcess $process) use ($vttOutput, $extractSucceeds, $whisperSucceeds) {
        $command = $process->command;

        if (! is_array($command)) {
            return Process::result(output: '');
        }

        $bin = (string) $command[0];

        if ($bin === 'ffmpeg') {
            $target = (string) end($command);

            if ($extractSucceeds) {
                file_put_contents($target, 'wav-bytes');
            }

            return Process::result(exitCode: $extractSucceeds ? 0 : 1);
        }

        if (str_contains($bin, 'whisper')) {
            if ($whisperSucceeds) {
                // whisper.cpp writes {-of value}.vtt itself — the `-of`
                // flag's value is the argument right after it.
                $ofIndex = array_search('-of', $command, true);
                $outputBase = $command[$ofIndex + 1];
                file_put_contents($outputBase.'.vtt', $vttOutput);
            }

            return Process::result(exitCode: $whisperSucceeds ? 0 : 1);
        }

        return Process::result(output: '');
    });
}

it('extracts audio, runs whisper-cli, and derives a transcript on success', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId]);

    fakeWhisper("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nToastmasters, not toast masters.");

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

    expect($captions->fresh()->status)->toBe('ready');
    Storage::disk('media')->assertExists($captions->fresh()->path);
    expect(Storage::disk('media')->get($captions->fresh()->path))->toContain('Toastmasters');

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->source)->toBe('whisper');
    expect($transcript->body)->toBe('Toastmasters, not toast masters.');
});

it('fails the captions asset without throwing when audio extraction fails', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId]);

    fakeWhisper('', extractSucceeds: false);

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('audio_extraction_failed');
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('fails the captions asset without throwing when whisper-cli fails', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId]);

    fakeWhisper('', whisperSucceeds: false);

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('transcription_failed');
});

it('fails cleanly when whisper-cli produces output this product cannot parse as VTT', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId]);

    fakeWhisper('this is not valid vtt output at all');

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('transcription_failed');
});

/**
 * Code-review finding: `tempnam(...).'.wav'` abandoned the tempnam'd
 * placeholder without unlinking it first, leaking a zero-byte scratch file
 * in the system temp dir on every single run. Asserts the temp dir has no
 * more `whisper_*` files after a run than it started with, across both a
 * success and a failure path.
 */
it('leaves no leaked whisper_* scratch files behind after a successful run', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId]);

    fakeWhisper("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello.");

    $before = glob(sys_get_temp_dir().'/whisper_*') ?: [];

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

    $after = glob(sys_get_temp_dir().'/whisper_*') ?: [];

    expect($after)->toBe($before);
});

it('leaves no leaked whisper_* scratch files behind after a failed run', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId]);

    fakeWhisper('', extractSucceeds: false);

    $before = glob(sys_get_temp_dir().'/whisper_*') ?: [];

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

    $after = glob(sys_get_temp_dir().'/whisper_*') ?: [];

    expect($after)->toBe($before);
});

it('fails the captions asset (not silently swallowed) when the storage write of the generated VTT fails', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId]);

    fakeWhisper("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello.");

    // Forces `Storage::disk('media')->put()` to return false (not throw —
    // `config/filesystems.php` has `'throw' => false` on every disk) for
    // the VTT write specifically: the destination directory is pre-created
    // then made read-only, so Flysystem's local write fails at the OS
    // level with `UnableToWriteFile` (caught inside `put()`), the same
    // real-world shape a full disk or a permissions problem takes. (Making
    // the PARENT directory read-only instead would fail directory
    // creation with `UnableToCreateDirectory`, which `put()` does not
    // catch — not the scenario under test here.)
    $captionDir = dirname(Storage::disk('media')->path($captions->path));
    mkdir($captionDir, 0755, true);
    chmod($captionDir, 0555);

    try {
        (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);
    } finally {
        chmod($captionDir, 0755);
    }

    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('transcription_failed');
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('does not clobber a speaker edit that landed while whisper was still running', function () {
    // Reconciliation-audit finding: whisper.cpp can run for minutes.
    // CaptionService::update() (a speaker's manual edit) can resolve the
    // same row to `ready` with hand-written content in the meantime — the
    // job must not blindly overwrite storage/status/transcript with stale
    // whisper output once it finally finishes.
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId]);

    $speakerVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nThe speaker's own correction.";
    Storage::disk('media')->put($captions->path, $speakerVtt);
    // Simulates CaptionService::update() having already resolved this row
    // while the whisper.cpp process (faked below) was still "running".
    $captions->update(['status' => 'ready']);
    SpeechTranscript::factory()->for($speech)->create([
        'body' => "The speaker's own correction.",
        'source' => 'edited',
    ]);

    fakeWhisper("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nStale whisper output.");

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

    expect($captions->fresh()->status)->toBe('ready');
    expect(Storage::disk('media')->get($captions->fresh()->path))->toBe($speakerVtt);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->source)->toBe('edited');
    expect($transcript->body)->toBe("The speaker's own correction.");
});

/**
 * STEP-09-VERIFICATION-PLAN.md §4.1: "old attempt A followed by disable/
 * re-enable B where A later succeeds ... B always remains authoritative."
 * Here A is still `processing` with a DIFFERENT (rotated) attempt id by the
 * time it finally writes — simulating a disable -> re-enable that landed
 * while A's whisper.cpp process was still legitimately running, in flight,
 * unaware. A's write must be rejected even though `status` alone still
 * reads `processing` throughout — the token is what makes this safe, not
 * status.
 */
it('does not clobber a newer attempt (B) with a stale attempt (A) that succeeds after A was superseded', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');

    $attemptA = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptA,
    ]);

    // Attempt B rotates onto the same row — as EnsureCaptionJob::enable()
    // would after a disable -> re-enable cycle — while A (below) is still
    // holding the OLD token in memory.
    $attemptB = (string) Str::uuid();
    $captions->update(['caption_attempt_id' => $attemptB, 'caption_queued_at' => now()]);

    fakeWhisper("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nStale attempt A output.");

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptA);

    $fresh = $captions->fresh();
    expect($fresh->status)->toBe('processing'); // still B's, untouched by A
    expect($fresh->caption_attempt_id)->toBe($attemptB);
    Storage::disk('media')->assertMissing($fresh->path);
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

/**
 * Same invariant, failure path: attempt A losing to a stale audio-
 * extraction failure must not stamp `failed`/`failure_code` onto B's row
 * either.
 */
it('does not clobber a newer attempt (B) with a stale attempt (A) failure', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');

    $attemptA = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptA,
    ]);

    $attemptB = (string) Str::uuid();
    $captions->update(['caption_attempt_id' => $attemptB, 'caption_queued_at' => now()]);

    fakeWhisper('', extractSucceeds: false);

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptA);

    $fresh = $captions->fresh();
    expect($fresh->status)->toBe('processing');
    expect($fresh->failure_code)->toBeNull();
    expect($fresh->caption_attempt_id)->toBe($attemptB);
});

/**
 * §4.1: "heartbeats at stage boundaries (before FFmpeg, before whisper-cli,
 * before storage write)". A successful run must leave a non-null
 * `caption_heartbeat_at` strictly newer than the moment the row was queued.
 */
it('advances the heartbeat during a run', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');

    $attemptId = (string) Str::uuid();
    $queuedAt = now()->subMinutes(5);
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId, 'caption_queued_at' => $queuedAt,
    ]);

    fakeWhisper("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello.");

    (new WhisperTranscriber)->transcribe($source, $captions, $attemptId);

    $fresh = $captions->fresh();
    expect($fresh->caption_heartbeat_at)->not->toBeNull();
    expect($fresh->caption_heartbeat_at->greaterThan($queuedAt))->toBeTrue();
});
