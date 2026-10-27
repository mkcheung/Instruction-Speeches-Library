<?php

use App\Http\Resources\SpeechResource;
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
 * The source fixtures below pass an explicit `byte_size` matching the
 * length of the bytes actually written to the fake disk. In production
 * `speech_assets.byte_size` for a source is the S3 `HeadObject`
 * ContentLength written at upload-complete, so it is authoritative — and
 * `downloadToLocalTemp()` now rejects a short read against it rather than
 * transcoding a truncated prefix and publishing it as `ready`. The factory
 * default is a random 1–40 MB figure, which no real upload could pair with
 * a 12-byte object.
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
            ['codec_type' => 'video', 'codec_name' => 'h264', 'width' => 1280, 'height' => 720, 'pix_fmt' => 'yuv420p'],
            ['codec_type' => 'audio', 'codec_name' => 'aac'],
        ],
        'format' => ['duration' => '12.5'],
    ];
}

it('remuxes a compliant h264/aac source, marks the video asset ready, and generates a primary poster', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg(compliantProbe());

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');
    expect($video->fresh()->path)->toBe("speeches/{$speech->ulid}/{$speech->ulid}/720p.mp4");
    Storage::disk('media')->assertExists($video->fresh()->path);

    // W4 (PLAN-APP-HEADER.md): the video asset's own width/height are now
    // persisted on a successful transcode, not just null forever — this is
    // the fallback --video-ar source for a speech with no poster.
    expect($video->fresh()->width)->toBe(1280);
    expect($video->fresh()->height)->toBe(720);

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

it('swaps width/height for a 90-degree rotated source, so a portrait phone clip is not persisted as landscape', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    // W4's trap: an iPhone clip stored 1920x1080 (coded, landscape) with a
    // rotate-90 display matrix — ffprobe reports the coded dimensions, the
    // browser decodes to 1080x1920 (portrait). Persisting the coded values
    // unmodified would reserve a landscape box for portrait content.
    fakeFfmpeg([
        'streams' => [
            [
                'codec_type' => 'video', 'codec_name' => 'h264',
                'width' => 1920, 'height' => 1080, 'pix_fmt' => 'yuv420p',
                'side_data_list' => [
                    ['side_data_type' => 'Display Matrix', 'rotation' => -90],
                ],
            ],
            ['codec_type' => 'audio', 'codec_name' => 'aac'],
        ],
        'format' => ['duration' => '12.5'],
    ]);

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');
    expect($video->fresh()->width)->toBe(1080);
    expect($video->fresh()->height)->toBe(1920);
});

it('does not swap width/height for an unrotated or 180-degree-rotated source', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg([
        'streams' => [
            [
                'codec_type' => 'video', 'codec_name' => 'h264',
                'width' => 1920, 'height' => 1080, 'pix_fmt' => 'yuv420p',
                'side_data_list' => [
                    ['side_data_type' => 'Display Matrix', 'rotation' => 180],
                ],
            ],
            ['codec_type' => 'audio', 'codec_name' => 'aac'],
        ],
        'format' => ['duration' => '12.5'],
    ]);

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');
    expect($video->fresh()->width)->toBe(1920);
    expect($video->fresh()->height)->toBe(1080);
});

it('fully transcodes an HEVC source instead of failing, via the full re-encode path', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
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
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
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
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
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
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
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
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
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
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
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

/**
 * Post-STEP-10 code review: the scratch-file and storage-failure gaps that
 * FfmpegTranscoder still had after WhisperTranscriber had already been
 * fixed for the identical ones.
 */
function scratchFiles(): array
{
    $found = [];

    foreach (['source_', 'transcode_', 'poster_master_', 'poster_v_', 'sprite_', 'poster_src_'] as $prefix) {
        $found = [...$found, ...(glob(sys_get_temp_dir().'/'.$prefix.'*') ?: [])];
    }

    sort($found);

    return $found;
}

it('leaves no scratch files behind, including the extensionless tempnam placeholders', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg(compliantProbe());

    $before = scratchFiles();

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');
    // Every `tempnam(...).'.ext'` site created TWO real files and only ever
    // cleaned up the suffixed one: 1 transcode_ + 1 poster_master_ + 6
    // poster_v_ + 1 sprite_ = 9 leaked inodes per run, which the byte-based
    // free-space watermark never notices.
    expect(scratchFiles())->toBe($before);
});

it('fails with storage_read_failed, not probe_failed, when the source object cannot be read', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    // Row exists, object does not — a transient object-store outage.
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => 12]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg(compliantProbe());

    $before = scratchFiles();

    (new FfmpegTranscoder)->transcode($video);

    // Previously `get()` returned null, `file_put_contents` wrote a 0-byte
    // file without complaint, and ffprobe's failure was recorded as
    // `probe_failed` — blaming the speaker's upload for a storage fault.
    expect($video->fresh()->status)->toBe('failed');
    expect($video->fresh()->failure_code)->toBe('storage_read_failed');
    expect(scratchFiles())->toBe($before);
});

it('fails with storage_read_failed when the source copy is truncated', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    // byte_size is the S3 HeadObject ContentLength written at
    // upload-complete, so a copy shorter than it is a truncated read.
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes') + 5_000]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    fakeFfmpeg(compliantProbe());

    (new FfmpegTranscoder)->transcode($video);

    // A truncated faststart-muxed MP4 usually still decodes, so without the
    // length check this published the opening slice of the speech as a
    // complete `ready` rendition.
    expect($video->fresh()->status)->toBe('failed');
    expect($video->fresh()->failure_code)->toBe('storage_read_failed');
});

it('leaves no scratch files behind when ffmpeg times out mid-transcode', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    Process::fake(function (PendingProcess $process) {
        $command = $process->command;
        $bin = is_array($command) ? $command[0] : '';

        if ($bin === 'ffprobe') {
            return Process::result(output: json_encode(compliantProbe()));
        }

        // Stands in for `ProcessTimedOutException`, which
        // `Process::timeout()->run()` THROWS rather than returning as an
        // unsuccessful result. The exact type is immaterial — what the
        // missing try/finally leaked on was *any* throw between the
        // download and the unlinks, and a real timeout is the likeliest.
        throw new RuntimeException('ffmpeg exceeded its timeout');
    });

    $before = scratchFiles();

    expect(fn () => (new FfmpegTranscoder)->transcode($video))->toThrow(RuntimeException::class);

    // Without the finally, this run stranded the full-size source copy and
    // the partial rendition permanently; two of those and
    // hasEnoughFreeSpace() wedges every later transcode on the host.
    expect(scratchFiles())->toBe($before);
});

it('keeps a successful video ready and cleans partial poster output when poster processing throws', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);
    Process::fake(function (PendingProcess $process) {
        $command = $process->command;
        $target = is_array($command) ? (string) end($command) : '';
        if (is_array($command) && $command[0] === 'ffprobe') {
            return Process::result(output: json_encode(compliantProbe()));
        }
        file_put_contents($target, 'partial output');
        if (str_contains($target, 'poster_master_')) {
            throw new RuntimeException('poster process timed out');
        }

        return Process::result();
    });
    $before = scratchFiles();

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');
    expect($speech->assets()->where('kind', 'poster')->exists())->toBeFalse();
    expect(scratchFiles())->toBe($before);
});

/**
 * R7: a replacement poster set is published only when the designated 640w
 * WebP primary survived. The helpers below break exactly that one variant
 * (generation, image probe, or upload) while every secondary succeeds.
 */
function fakeFfmpegBreakingPrimary(string $mode): void
{
    Process::fake(function (PendingProcess $process) use ($mode) {
        $command = $process->command;
        $bin = $command[0];
        $target = (string) end($command);
        $isPrimary = $bin === 'ffmpeg'
            && str_ends_with($target, '.webp')
            && in_array("scale='min(640,iw)':-2", $command, true);

        if ($bin === 'ffprobe') {
            if (str_contains($target, 'source_') || str_contains($target, 'transcode_') || str_contains($target, 'poster_src_')) {
                return Process::result(output: json_encode(compliantProbe()));
            }
            if ($mode === 'probe' && @file_get_contents($target) === 'primary-bytes') {
                return Process::result(output: '', exitCode: 1);
            }

            return Process::result(output: json_encode(['streams' => [['width' => 640, 'height' => 360]]]));
        }

        if ($isPrimary && $mode === 'generate') {
            return Process::result(output: '', exitCode: 1);
        }

        file_put_contents($target, $isPrimary ? 'primary-bytes' : (str_contains($target, '.mp4') ? 'video-bytes' : 'image-bytes'));

        return Process::result(output: '');
    });
}

/** @return array{0: Speech, 1: SpeechAsset} a ready video with a healthy poster set at 2000ms and a sprite */
function speechWithHealthyPosterSet(): array
{
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);
    fakeFfmpeg(compliantProbe());
    (new FfmpegTranscoder)->transcode($video);

    return [$speech, $video->fresh()];
}

/** Makes the disk refuse to store the 640w WebP of any frame. */
function failPrimaryUploads(): void
{
    $disk = Mockery::mock(Storage::disk('media'))->makePartial();
    $disk->shouldReceive('writeStream')->andReturnUsing(function ($path, $resource, $options = []) use ($disk) {
        if (str_ends_with($path, '/640.webp')) {
            return false;
        }

        $disk->getDriver()->writeStream($path, $resource, $options ?? []);

        return true;
    });
    Storage::set('media', $disk);
}

dataset('primary failure modes', ['generation' => ['generate'], 'probe' => ['probe'], 'upload' => ['upload']]);

it('keeps the existing poster set and primary when only the replacement primary fails', function (string $mode) {
    [$speech, $video] = speechWithHealthyPosterSet();
    $before = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'poster')->orderBy('id')->get();
    $oldPrimary = $before->firstWhere('is_primary', true);
    $oldBytes = Storage::disk('media')->get($oldPrimary->path);
    $spriteBefore = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'sprite')->first();

    fakeFfmpegBreakingPrimary($mode);
    if ($mode === 'upload') {
        failPrimaryUploads();
    }
    $scratchBefore = scratchFiles();

    // Distinct frame (7250ms) and same frame (2000ms): neither may disturb the old set.
    (new FfmpegTranscoder)->generatePoster($video, 7.25);
    (new FfmpegTranscoder)->generatePoster($video, 2.0);

    $after = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'poster')->orderBy('id')->get();
    expect($after->pluck('id')->all())->toBe($before->pluck('id')->all());
    expect($after->where('is_primary', true))->toHaveCount(1);
    expect($after->firstWhere('is_primary', true)->id)->toBe($oldPrimary->id);
    // The old primary's object is neither deleted nor overwritten.
    Storage::disk('media')->assertExists($oldPrimary->path);
    expect(Storage::disk('media')->get($oldPrimary->path))->toBe($oldBytes);
    // No secondary of the failed attempt was published at the distinct frame.
    Storage::disk('media')->assertMissing("speeches/{$speech->ulid}/{$speech->ulid}/poster/7250/320.webp");
    expect(SpeechAsset::query()->find($spriteBefore->id))->not->toBeNull();

    $payload = (new SpeechResource($speech->fresh()->load('assets')))->toArray(request());
    expect($payload['poster']['width'])->toBe($oldPrimary->width);
    expect(scratchFiles())->toBe($scratchBefore);
})->with('primary failure modes');

it('publishes a complete replacement set and swaps the primary when every variant succeeds', function () {
    [$speech, $video] = speechWithHealthyPosterSet();
    $oldPrimary = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'poster')->where('is_primary', true)->first();

    fakeFfmpeg(compliantProbe());
    (new FfmpegTranscoder)->generatePoster($video, 7.25);

    $posters = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'poster')->get();
    expect($posters)->toHaveCount(6);
    expect($posters->where('is_primary', true))->toHaveCount(1);
    expect($posters->firstWhere('is_primary', true)->id)->not->toBe($oldPrimary->id);
    expect($posters->pluck('poster_time_seconds')->map(fn ($t) => (float) $t)->unique()->all())->toBe([7.25]);
});

it('publishes no poster rows on initial derivation when the primary fails, but keeps the video ready and the sprite', function (string $mode) {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    Storage::disk('media')->put('uploads/1/u/source', 'source-bytes');
    SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'path' => 'uploads/1/u/source', 'byte_size' => strlen('source-bytes')]);
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);
    fakeFfmpegBreakingPrimary($mode);
    if ($mode === 'upload') {
        failPrimaryUploads();
    }
    $before = scratchFiles();

    (new FfmpegTranscoder)->transcode($video);

    expect($video->fresh()->status)->toBe('ready');
    expect($speech->assets()->where('kind', 'poster')->exists())->toBeFalse();
    expect($speech->assets()->where('kind', 'sprite')->count())->toBe(1);
    expect(scratchFiles())->toBe($before);
})->with('primary failure modes');

it('replaces the sprite independently of a poster set whose primary failed, and keeps the old poster set', function () {
    [$speech, $video] = speechWithHealthyPosterSet();
    $oldPosterIds = $speech->assets()->where('kind', 'poster')->pluck('id')->sort()->values()->all();
    $oldSprite = $speech->assets()->where('kind', 'sprite')->first();

    fakeFfmpegBreakingPrimary('generate');
    $method = new ReflectionMethod(FfmpegTranscoder::class, 'runPosterPipeline');
    $source = tempnam(sys_get_temp_dir(), 'poster_src_');
    try {
        $method->invoke(new FfmpegTranscoder, $video, $source, null, true);
    } finally {
        @unlink($source);
    }

    expect($speech->assets()->where('kind', 'poster')->pluck('id')->sort()->values()->all())->toBe($oldPosterIds);
    $sprites = $speech->assets()->where('kind', 'sprite')->get();
    expect($sprites)->toHaveCount(1);
    expect($sprites->first()->id)->not->toBe($oldSprite->id);
});
