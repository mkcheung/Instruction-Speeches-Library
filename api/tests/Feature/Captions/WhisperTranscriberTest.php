<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\WhisperTranscriber;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

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
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing']);

    fakeWhisper("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nToastmasters, not toast masters.");

    (new WhisperTranscriber)->transcribe($source, $captions);

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
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing']);

    fakeWhisper('', extractSucceeds: false);

    (new WhisperTranscriber)->transcribe($source, $captions);

    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('audio_extraction_failed');
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('fails the captions asset without throwing when whisper-cli fails', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing']);

    fakeWhisper('', whisperSucceeds: false);

    (new WhisperTranscriber)->transcribe($source, $captions);

    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('transcription_failed');
});

it('fails cleanly when whisper-cli produces output this product cannot parse as VTT', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($source->path, 'source-bytes');
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing']);

    fakeWhisper('this is not valid vtt output at all');

    (new WhisperTranscriber)->transcribe($source, $captions);

    expect($captions->fresh()->status)->toBe('failed');
    expect($captions->fresh()->failure_code)->toBe('transcription_failed');
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
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing']);

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

    (new WhisperTranscriber)->transcribe($source, $captions);

    expect($captions->fresh()->status)->toBe('ready');
    expect(Storage::disk('media')->get($captions->fresh()->path))->toBe($speakerVtt);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->source)->toBe('edited');
    expect($transcript->body)->toBe("The speaker's own correction.");
});
