<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\Transcoding\FfmpegTranscoder;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-04 extends STEP-03's remux-only pipeline: h264+aac+<=1080p still
 * remuxes via `-c copy`; everything else ffprobe can read (HEVC, >1080p,
 * 10-bit/HDR) now goes through a full libx264 re-encode instead of failing.
 * §9.5's poster/sprite pipeline runs automatically after either path
 * succeeds. Process::fake() stands in for ffprobe/ffmpeg throughout (real
 * binaries are not assumed present in this test environment); Storage::fake()
 * stands in for the `media` disk.
 *
 * fakeFfmpeg() below is a single generic Process::fake() callback shared by
 * every test in this file: it recognizes ffprobe/ffmpeg invocations by the
 * tempnam() prefix FfmpegTranscoder uses for each stage's scratch file
 * ('source_', 'transcode_', 'poster_master_', 'poster_v_', 'sprite_',
 * 'poster_src_') and writes plausible stub output so every stage after the
 * first can actually run, rather than special-casing each test's command
 * sequence by hand.
 */
function fakeFfmpeg(array $videoProbe): void
{
    Process::fake(function (PendingProcess $process) use ($videoProbe) {
        $command = $process->command;

        if (! is_array($command)) {
            return Process::result(output: '');
        }

        $bin = $command[0];
        $target = (string) end($command);

        if ($bin === 'ffprobe') {
            if (str_contains($target, 'source_') || str_contains($target, 'transcode_') || str_contains($target, 'poster_src_')) {
                return Process::result(output: json_encode($videoProbe));
            }

            // Image dimension probes (poster/sprite variants).
            return Process::result(output: json_encode([
                'streams' => [['width' => 640, 'height' => 360]],
            ]));
        }

        if ($bin === 'ffmpeg') {
            file_put_contents($target, str_contains($target, '.mp4') ? 'video-bytes' : 'image-bytes');

            return Process::result(output: '');
        }

        return Process::result(output: '');
    });
}

function compliantProbe(): array
{
    return [
        'streams' => [
            ['codec_type' => 'video', 'codec_name' => 'h264', 'height' => 720, 'pix_fmt' => 'yuv420p'],
            ['codec_type' => 'audio', 'codec_name' => 'aac'],
        ],
        'format' => ['duration' => '12.5'],
    ];
}

it('remuxes a compliant h264/aac source, marks the video asset ready, and generates a primary poster', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source']);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg(compliantProbe());

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');
    expect($video->fresh()->path)->toBe("speeches/{$speech->ulid}/{$speech->ulid}/720p.mp4");
    Storage::disk('media')->assertExists($video->fresh()->path);

    $posters = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'poster')->get();
    // Three widths x two formats.
    expect($posters)->toHaveCount(6);
    expect($posters->where('is_primary', true))->toHaveCount(1);

    $primary = $posters->firstWhere('is_primary', true);
    expect($primary->format)->toBe('webp');
    expect($primary->width)->toBe(640);
    expect($primary->height)->toBe(360);
    expect($primary->status)->toBe('ready');

    $sprite = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'sprite')->first();
    expect($sprite)->not->toBeNull();
    expect($sprite->is_primary)->toBeFalse();
});

it('fully transcodes an HEVC source instead of failing, via the full re-encode path', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source']);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg([
        'streams' => [
            ['codec_type' => 'video', 'codec_name' => 'hevc', 'height' => 1080, 'pix_fmt' => 'yuv420p'],
            ['codec_type' => 'audio', 'codec_name' => 'aac'],
        ],
        'format' => ['duration' => '9.0'],
    ]);

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');

    Process::assertRan(function (PendingProcess $process) {
        return is_array($process->command)
            && $process->command[0] === 'ffmpeg'
            && in_array('libx264', $process->command, true)
            && ! in_array('copy', $process->command, true);
    });
});

it('downscales a >1080p source and tonemaps a 10-bit HDR source in the same ffmpeg invocation', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source']);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg([
        'streams' => [
            ['codec_type' => 'video', 'codec_name' => 'hevc', 'height' => 2160, 'pix_fmt' => 'yuv420p10le'],
            ['codec_type' => 'audio', 'codec_name' => 'aac'],
        ],
        'format' => ['duration' => '20.0'],
    ]);

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');

    Process::assertRan(function (PendingProcess $process) {
        if (! is_array($process->command) || $process->command[0] !== 'ffmpeg') {
            return false;
        }

        $vfIndex = array_search('-vf', $process->command, true);

        if ($vfIndex === false) {
            return false;
        }

        $filters = $process->command[$vfIndex + 1];

        return str_contains($filters, 'zscale') && str_contains($filters, 'tonemap') && str_contains($filters, "scale='min(1280,iw)':-2");
    });
});

it('fails visibly with a user-safe code when ffprobe cannot read a video stream at all', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source']);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    Process::fake(function (PendingProcess $process) {
        return Process::result(output: json_encode(['streams' => [], 'format' => ['duration' => '0']]));
    });

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('failed');
    expect($video->fresh()->failure_code)->toBe('probe_failed');
    expect($video->fresh()->failure_detail)->not->toBeNull();
});

it('fails visibly when no source asset exists for the speech', function () {
    $speech = Speech::factory()->create();
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('failed');
    expect($video->fresh()->failure_code)->toBe('source_missing');
});

it('fails the video with insufficient_disk_space and never runs ffmpeg when below the free-space watermark', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source']);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    // No real filesystem reliably has PHP_INT_MAX bytes free, so this
    // deterministically trips the watermark without mocking disk_free_space()
    // itself (a global PHP function, not a facade).
    Config::set('media.free_space_watermark_bytes', PHP_INT_MAX);

    Process::fake();

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('failed');
    expect($video->fresh()->failure_code)->toBe('insufficient_disk_space');
    Process::assertNothingRan();
});

it('regenerates the poster set with an explicit chosen time, replacing the old primary without violating the unique index', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source']);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg(compliantProbe());
    (new FfmpegTranscoder)->transcode($video);

    $video = $video->fresh();
    expect($video->status)->toBe('ready');

    $originalPrimary = SpeechAsset::query()
        ->where('speech_id', $speech->id)->where('kind', 'poster')->where('is_primary', true)->first();
    $originalSprite = SpeechAsset::query()
        ->where('speech_id', $speech->id)->where('kind', 'sprite')->first();

    fakeFfmpeg(compliantProbe());
    (new FfmpegTranscoder)->generatePoster($video, 7.25);

    $posters = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'poster')->get();
    expect($posters)->toHaveCount(6);
    expect($posters->where('is_primary', true))->toHaveCount(1);

    $newPrimary = $posters->firstWhere('is_primary', true);
    expect($newPrimary->id)->not->toBe($originalPrimary->id);
    expect((float) $newPrimary->poster_time_seconds)->toBe(7.25);

    // Sprite is untouched by a poster-only regeneration.
    $sprite = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'sprite')->first();
    expect($sprite->id)->toBe($originalSprite->id);
});

it('clamps an explicit poster time to [0, duration] without the automatic [2, 30] clamp', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source']);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg(compliantProbe());
    (new FfmpegTranscoder)->transcode($video);
    $video = $video->fresh();

    fakeFfmpeg(compliantProbe());
    // Explicit time of 0.5s: below the automatic clamp's 2s floor, but a
    // valid explicit choice within [0, duration] (duration is 12.5s here).
    (new FfmpegTranscoder)->generatePoster($video, 0.5);

    $primary = SpeechAsset::query()
        ->where('speech_id', $speech->id)->where('kind', 'poster')->where('is_primary', true)->first();

    expect((float) $primary->poster_time_seconds)->toBe(0.5);
});
