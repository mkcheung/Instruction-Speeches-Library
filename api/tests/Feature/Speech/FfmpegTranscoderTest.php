<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\Transcoding\FfmpegTranscoder;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-03 is remux-only: h264+aac+<=1080p succeeds via `-c copy`, anything
 * else lands the video asset in a visible Failed state — the acceptance
 * item "an unmodified iPhone .MOV fails visibly, with a Retry button."
 * Process::fake() stands in for ffprobe/ffmpeg (not assumed present in
 * this test environment); Storage::fake() stands in for the `media` disk.
 */
it('remuxes a compliant h264/aac source and marks the video asset ready', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source']);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    // ffmpeg is faked and never actually runs, so it never writes the real
    // output file the transcoder reads back with file_get_contents() — the
    // fake callback does that write itself, standing in for `-c copy`.
    Process::fake(function (PendingProcess $process) {
        $command = $process->command;
        if (is_array($command) && $command[0] === 'ffprobe') {
            return Process::result(output: json_encode([
                'streams' => [
                    ['codec_type' => 'video', 'codec_name' => 'h264', 'height' => 720],
                    ['codec_type' => 'audio', 'codec_name' => 'aac'],
                ],
                'format' => ['duration' => '12.5'],
            ]));
        }

        if (is_array($command) && $command[0] === 'ffmpeg') {
            $output = end($command);
            file_put_contents($output, 'remuxed-bytes');

            return Process::result(output: '');
        }

        return Process::result(output: '');
    });

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');
    expect($video->fresh()->path)->toBe("speeches/{$speech->ulid}/{$speech->ulid}/720p.mp4");
    Storage::disk('media')->assertExists($video->fresh()->path);
});

it('fails visibly with a user-safe code when the source is not h264/aac (the iPhone .MOV case)', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source']);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    Process::fake(function (PendingProcess $process) {
        return Process::result(output: json_encode([
            'streams' => [
                ['codec_type' => 'video', 'codec_name' => 'hevc', 'height' => 1080],
                ['codec_type' => 'audio', 'codec_name' => 'aac'],
            ],
            'format' => ['duration' => '9.0'],
        ]));
    });

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('failed');
    expect($video->fresh()->failure_code)->toBe('unsupported_format');
    expect($video->fresh()->failure_detail)->not->toBeNull();
});

it('fails visibly when no source asset exists for the speech', function () {
    $speech = Speech::factory()->create();
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('failed');
    expect($video->fresh()->failure_code)->toBe('source_missing');
});
