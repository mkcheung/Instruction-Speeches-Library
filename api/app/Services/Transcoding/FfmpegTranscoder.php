<?php

namespace App\Services\Transcoding;

use App\Models\Speech;
use App\Models\SpeechAsset;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * The dev binding (App\Providers\AppServiceProvider). STEP-03 shipped
 * remux-only; STEP-04 (this class, now) adds the full HEVC/HDR/rotation
 * transcode path plus the §9.5 poster/sprite pipeline, while preserving the
 * remux fast path exactly as STEP-03 left it.
 *
 * On macOS, Docker Desktop cannot pass through VideoToolbox (§21.3), so
 * this class always software-encodes in dev — `-preset veryfast` exists
 * precisely because of that constraint, not despite it.
 *
 * ## Environment findings this file's ffmpeg invocations were verified
 * against (STEP-04, 2026-08-08; ffmpeg/ffprobe are NOT installed on the
 * host — verified with real binaries inside the `ffmpeg-worker` compose
 * target, ffmpeg 8.1.2 / built `--enable-gpl --enable-libx264
 * --enable-libwebp --enable-libzimg`):
 *
 * - `zscale` and `tonemap` filters: PRESENT and exercised end-to-end
 *   against a synthetic 3840x2160 10-bit `yuv420p10le` HEVC source tagged
 *   with real HDR10 VUI (`colorprim=bt2020:transfer=smpte2084:
 *   colormatrix=bt2020nc` via `-x265-params`, required — `-color_primaries`
 *   alone did not stick). The full tonemap+downscale filter chain below
 *   ran to completion (exit 0) and produced a 1280x720 yuv420p H.264
 *   output. The naive synthetic source (no VUI tags) reliably reproduces
 *   `zscale`'s "no path between colorspaces" error, which is *why* real
 *   HDR metadata was added to the fixture rather than trusted to exist.
 * - `thumbnail`, `tile`, `fps` filters and `libwebp`: PRESENT, all
 *   exercised — poster master extraction (`-ss` before `-i`), 320w
 *   WebP/JPEG derivation, and the `fps=…,scale=160:-2,tile=5x2` sprite
 *   pass all ran to completion against a real (locally re-encoded)
 *   rendition file.
 * - **Rotation: NOT positively verified.** Multiple attempts to construct
 *   a test fixture carrying a display-matrix/tkhd rotation this ffmpeg
 *   build would visibly re-apply on re-encode did not succeed in this
 *   session — `-metadata:s:v:0 rotate=90` (both muxed fresh and via a
 *   `-c copy` remux) produced no `[SIDE_DATA]` block ffprobe would report,
 *   and `-display_rotation:s:v:0` was rejected as an input-only option in
 *   the position tried. This class therefore does **not** add any explicit
 *   rotation handling: it relies on ffmpeg's documented default
 *   auto-rotate-on-decode behavior (confirmed present as `-autorotate` in
 *   `ffmpeg -h full`, default enabled since ffmpeg 4.4; this build is
 *   8.1.2), exactly as MODERNIZATION_PLAN §5.6/§9.5 describe it — but that
 *   default was NOT independently exercised against a real rotated fixture
 *   here. If a genuinely rotated source ever plays back sideways, this is
 *   the first place to add an explicit `-noautorotate`/transpose
 *   workaround and a regression fixture.
 */
class FfmpegTranscoder implements TranscoderContract
{
    private const MAX_HEIGHT = 1080;

    /**
     * §9.5: "three widths … each capped at the master's actual width —
     * don't upscale." The cap-without-upscale property comes for free from
     * ffmpeg's `scale='min(W,iw)':-2` — a source narrower than W simply
     * passes through unchanged — so no separate probe-then-clamp step is
     * needed before deriving each variant.
     */
    private const POSTER_WIDTHS = [320, 640, 1280];

    /**
     * §9.5: "the 640w webp is the single primary poster row."
     */
    private const PRIMARY_POSTER_WIDTH = 640;

    private const PRIMARY_POSTER_FORMAT = 'webp';

    /**
     * The standard zscale+tonemap chain for 10-bit HDR → SDR (§5.6, §9.5).
     * See this class's doc comment for exactly how (and how much) this was
     * verified in this environment.
     */
    private const TONEMAP_FILTER_CHAIN = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

    /**
     * §5.6/§9.5's shared downscale rule, applied identically to the video
     * transcode and to the poster master. Deliberately width-only (caps at
     * 1280w, `-2` lets ffmpeg pick a matching even height) to stay
     * consistent with `isRemuxCompatible()`'s own height-only compatibility
     * check just below — both assume landscape-dominant sources, which is
     * the same simplification the pre-existing remux path already made and
     * not something this slice re-solves for portrait 4K.
     */
    private const DOWNSCALE_FILTER = "scale='min(1280,iw)':-2";

    public function transcode(SpeechAsset $videoAsset): void
    {
        if (! $this->hasEnoughFreeSpace()) {
            $this->fail($videoAsset, 'insufficient_disk_space', 'Our storage is temporarily full. Please try again shortly.');

            return;
        }

        $source = $videoAsset->speech->assets()->where('kind', 'source')->first();

        if ($source === null) {
            $this->fail($videoAsset, 'source_missing', 'No source asset found for this speech.');

            return;
        }

        $localSource = $this->downloadToLocalTemp($source);
        $probe = $this->probe($localSource);

        if ($probe === null || $probe['codec_video'] === null) {
            @unlink($localSource);
            $this->fail($videoAsset, 'probe_failed', 'ffprobe could not read the uploaded file.');

            return;
        }

        // Deterministic output path (§9.2): never a timestamp suffix, so
        // duplicate output is structurally impossible on retry.
        $outputPath = "speeches/{$videoAsset->speech->ulid}/{$videoAsset->speech->ulid}/720p.mp4";
        $tmpOutput = tempnam(sys_get_temp_dir(), 'transcode_').'.mp4';

        if ($this->isRemuxCompatible($probe)) {
            $result = Process::timeout(300)->run([
                'ffmpeg', '-nostdin', '-y',
                '-i', $localSource,
                '-c', 'copy',
                '-movflags', '+faststart',
                $tmpOutput,
            ]);
            $failureCode = 'remux_failed';
        } else {
            // STEP-04: everything ffprobe can actually read that isn't
            // already remux-compatible — HEVC, >1080p, 10-bit/HDR — goes
            // through a full re-encode (§5.6). Downscale and tonemap, when
            // needed, happen in this same ffmpeg invocation.
            $videoFilters = $this->buildVideoFilters($probe);

            $command = ['ffmpeg', '-nostdin', '-y', '-i', $localSource];
            if ($videoFilters !== null) {
                $command[] = '-vf';
                $command[] = $videoFilters;
            }
            array_push(
                $command,
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart',
                $tmpOutput,
            );

            $result = Process::timeout(3500)->run($command);
            $failureCode = 'transcode_failed';
        }

        if (! $result->successful()) {
            @unlink($localSource);
            @unlink($tmpOutput);
            $this->fail($videoAsset, $failureCode, 'We had trouble processing this video. Please try again.');

            return;
        }

        Storage::disk($source->disk)->put($outputPath, file_get_contents($tmpOutput));

        // §9.5: extract the poster/sprite from the rendition we just wrote
        // (the local copy is still on disk here — no need to re-download
        // from Storage), never from the source. Best-effort: a poster
        // extraction failure must not undo an otherwise-successful video
        // transcode (§9.5: "no poster is a designed state, not a broken
        // image" — there is no failure state for posters to land in).
        try {
            $this->runPosterPipeline($videoAsset, $tmpOutput, null, includeSprite: true);
        } catch (\Throwable $e) {
            Log::warning('Poster pipeline failed after a successful transcode.', [
                'video_asset_id' => $videoAsset->id,
                'exception' => $e->getMessage(),
            ]);
        }

        @unlink($localSource);
        @unlink($tmpOutput);

        $this->writeFinalStatus($videoAsset->id, [
            'status' => 'ready',
            'disk' => $source->disk,
            'path' => $outputPath,
            'byte_size' => Storage::disk($source->disk)->size($outputPath),
            'duration_seconds' => $probe['duration'],
        ]);
    }

    public function generatePoster(SpeechAsset $videoAsset, ?float $explicitTimeSeconds): void
    {
        if (! $this->hasEnoughFreeSpace()) {
            // Posters have no visible "failed" state (§9.5) — a blocked
            // regeneration is a silent no-op, not a written failure.
            Log::warning('Skipping poster regeneration: insufficient free disk space.', [
                'video_asset_id' => $videoAsset->id,
            ]);

            return;
        }

        $localRendition = tempnam(sys_get_temp_dir(), 'poster_src_').'.mp4';

        try {
            file_put_contents($localRendition, Storage::disk($videoAsset->disk)->get($videoAsset->path));
            $this->runPosterPipeline($videoAsset, $localRendition, $explicitTimeSeconds, includeSprite: false);
        } catch (\Throwable $e) {
            Log::warning('Poster regeneration failed.', [
                'video_asset_id' => $videoAsset->id,
                'exception' => $e->getMessage(),
            ]);
        } finally {
            @unlink($localRendition);
        }
    }

    /**
     * The shared body of both entry points (§9.5): extract a master frame
     * from `$localRenditionPath` (the transcoded rendition, downscaled to
     * at most 1280w by the same rule the video transcode uses), derive
     * three widths × two formats from it, optionally build the sprite
     * strip, then write every resulting asset row in one transaction so
     * clearing the old primary and setting the new one can never straddle
     * the `uq_assets_primary` partial unique index.
     */
    private function runPosterPipeline(SpeechAsset $videoAsset, string $localRenditionPath, ?float $explicitTimeSeconds, bool $includeSprite): void
    {
        $probe = $this->probe($localRenditionPath);

        if ($probe === null || $probe['duration'] <= 0) {
            Log::warning('Poster pipeline: could not probe the rendition.', ['video_asset_id' => $videoAsset->id]);

            return;
        }

        $duration = $probe['duration'];
        $seekSeconds = $explicitTimeSeconds !== null
            // Explicit (speaker-chosen) frame: clamp only to the video's
            // own duration — deliberately no [2, 30] automatic-seek clamp.
            ? max(0.0, min($explicitTimeSeconds, $duration))
            // Automatic: clamp(10% of duration, 2, 30).
            : max(2.0, min(0.10 * $duration, 30.0));
        $seekSeconds = max(0.0, min($seekSeconds, $duration));

        $localTemps = [];

        $masterPath = tempnam(sys_get_temp_dir(), 'poster_master_').'.jpg';
        $localTemps[] = $masterPath;

        // §9.5: `-ss` MUST be before `-i` — an input seek that jumps to the
        // nearest keyframe, not an output seek that decodes every frame up
        // to it ("the most common mistake in poster pipelines").
        $masterResult = Process::timeout(60)->run([
            'ffmpeg', '-nostdin', '-y',
            '-ss', (string) $seekSeconds,
            '-i', $localRenditionPath,
            '-map', '0:v:0', '-an',
            '-vf', 'thumbnail=n=100,'.self::DOWNSCALE_FILTER,
            '-frames:v', '1', '-q:v', '2', '-f', 'image2',
            $masterPath,
        ]);

        if (! $masterResult->successful() || ! file_exists($masterPath) || filesize($masterPath) === 0) {
            $this->cleanupTemps($localTemps);
            Log::warning('Poster pipeline: master frame extraction failed.', ['video_asset_id' => $videoAsset->id]);

            return;
        }

        $timeMs = (int) round($seekSeconds * 1000);
        $ulid = $videoAsset->speech->ulid;

        $variants = [];

        foreach (self::POSTER_WIDTHS as $width) {
            foreach (['webp' => 'webp', 'jpeg' => 'jpg'] as $format => $extension) {
                $localVariant = tempnam(sys_get_temp_dir(), 'poster_v_').'.'.$extension;
                $localTemps[] = $localVariant;

                $qualityArgs = $format === 'webp' ? ['-q:v', '82'] : ['-q:v', '4'];

                $result = Process::timeout(30)->run([
                    'ffmpeg', '-nostdin', '-y',
                    '-i', $masterPath,
                    '-vf', "scale='min({$width},iw)':-2",
                    ...$qualityArgs,
                    $localVariant,
                ]);

                if (! $result->successful()) {
                    continue;
                }

                $dimensions = $this->probeImageDimensions($localVariant);

                if ($dimensions === null) {
                    continue;
                }

                $variants[] = [
                    'kind' => 'poster',
                    'format' => $format,
                    'path' => "speeches/{$ulid}/{$ulid}/poster/{$timeMs}/{$width}.{$extension}",
                    'local' => $localVariant,
                    'width' => $dimensions[0],
                    'height' => $dimensions[1],
                    'is_primary' => $width === self::PRIMARY_POSTER_WIDTH && $format === self::PRIMARY_POSTER_FORMAT,
                    'poster_time_seconds' => $seekSeconds,
                ];
            }
        }

        if ($variants === []) {
            $this->cleanupTemps($localTemps);
            Log::warning('Poster pipeline: every width/format derivation failed.', ['video_asset_id' => $videoAsset->id]);

            return;
        }

        $spriteVariant = null;

        if ($includeSprite) {
            $spriteLocal = tempnam(sys_get_temp_dir(), 'sprite_').'.jpg';
            $localTemps[] = $spriteLocal;

            $spriteResult = Process::timeout(60)->run([
                'ffmpeg', '-nostdin', '-y',
                '-i', $localRenditionPath,
                '-vf', sprintf('fps=10/%F,scale=160:-2,tile=5x2', $duration),
                '-frames:v', '1',
                $spriteLocal,
            ]);

            if ($spriteResult->successful()) {
                $dimensions = $this->probeImageDimensions($spriteLocal);

                if ($dimensions !== null) {
                    $spriteVariant = [
                        'kind' => 'sprite',
                        'format' => 'jpeg',
                        'path' => "speeches/{$ulid}/{$ulid}/sprite.jpg",
                        'local' => $spriteLocal,
                        'width' => $dimensions[0],
                        'height' => $dimensions[1],
                        'is_primary' => false,
                        'poster_time_seconds' => null,
                    ];
                }
            }
        }

        $disk = $videoAsset->disk;
        $allVariants = $spriteVariant !== null ? [...$variants, $spriteVariant] : $variants;

        foreach ($allVariants as &$variant) {
            Storage::disk($disk)->put($variant['path'], file_get_contents($variant['local']));
            $variant['byte_size'] = Storage::disk($disk)->size($variant['path']);
        }
        unset($variant);

        // Only clear the kinds we actually have fresh replacements for:
        // 'poster' is always regenerated by this method, but 'sprite' is
        // only touched when $includeSprite produced one — a poster-only
        // regeneration (generatePoster()) must leave the existing sprite
        // row alone.
        $kindsToReplace = $spriteVariant !== null ? ['poster', 'sprite'] : ['poster'];

        DB::transaction(function () use ($videoAsset, $allVariants, $disk, $kindsToReplace) {
            // Exit guard, same spirit as writeFinalStatus()'s: the speech
            // may have been deleted while ffmpeg was running. Re-check
            // under lock before writing rows that reference its id.
            $speech = Speech::query()->lockForUpdate()->find($videoAsset->speech_id);

            if ($speech === null) {
                return;
            }

            // Delete-then-insert inside the same transaction: clearing the
            // old primary poster row and inserting the new one atomically
            // is what keeps `uq_assets_primary` (UNIQUE on
            // (speech_id, kind) WHERE is_primary) from rejecting the
            // insert — see §9.5's explicit warning about this.
            SpeechAsset::query()
                ->where('speech_id', $videoAsset->speech_id)
                ->whereIn('kind', $kindsToReplace)
                ->delete();

            foreach ($allVariants as $variant) {
                SpeechAsset::query()->create([
                    'speech_id' => $videoAsset->speech_id,
                    'kind' => $variant['kind'],
                    'format' => $variant['format'],
                    'disk' => $disk,
                    'path' => $variant['path'],
                    'mime_type' => $variant['format'] === 'webp' ? 'image/webp' : 'image/jpeg',
                    'byte_size' => $variant['byte_size'],
                    'status' => 'ready',
                    'is_primary' => $variant['is_primary'],
                    'width' => $variant['width'],
                    'height' => $variant['height'],
                    'poster_time_seconds' => $variant['poster_time_seconds'],
                ]);
            }
        });

        $this->cleanupTemps($localTemps);
    }

    /**
     * @param  array<int, string>  $paths
     */
    private function cleanupTemps(array $paths): void
    {
        foreach ($paths as $path) {
            @unlink($path);
        }
    }

    /**
     * @return array{0: int, 1: int}|null
     */
    private function probeImageDimensions(string $localPath): ?array
    {
        $result = Process::run([
            'ffprobe', '-v', 'error',
            '-print_format', 'json',
            '-show_entries', 'stream=width,height',
            $localPath,
        ]);

        if (! $result->successful()) {
            return null;
        }

        $data = json_decode($result->output(), true);
        $width = $data['streams'][0]['width'] ?? null;
        $height = $data['streams'][0]['height'] ?? null;

        if ($width === null || $height === null) {
            return null;
        }

        return [(int) $width, (int) $height];
    }

    /**
     * R10, a global watermark checked before ANY ffmpeg work starts in
     * either entry point — not a per-file check. Compares against the same
     * local filesystem downloadToLocalTemp() and the poster pipeline write
     * scratch files to.
     */
    private function hasEnoughFreeSpace(): bool
    {
        $free = @disk_free_space(sys_get_temp_dir());

        // disk_free_space() returning false means "couldn't determine",
        // not "no space" — fail open rather than block every transcode on
        // an environment where this call itself doesn't work.
        if ($free === false) {
            return true;
        }

        return $free >= (float) config('media.free_space_watermark_bytes');
    }

    /**
     * @param  array{codec_video: ?string, codec_audio: ?string, height: int, duration: float, pix_fmt: ?string}  $probe
     */
    private function buildVideoFilters(array $probe): ?string
    {
        $filters = [];

        if ($this->isHdr10Bit($probe['pix_fmt'] ?? '')) {
            $filters[] = self::TONEMAP_FILTER_CHAIN;
        }

        if ($probe['height'] > self::MAX_HEIGHT) {
            $filters[] = self::DOWNSCALE_FILTER;
        }

        return $filters === [] ? null : implode(',', $filters);
    }

    /**
     * 10/12-bit pixel formats consistently end in "10le"/"10be"/"12le"/
     * "12be" (`yuv420p10le`, `p010le`, `yuv420p12le`, …) — matching the
     * suffix rather than an enumerated list is what makes this reliable
     * across ffmpeg's many 10-bit format spellings.
     */
    private function isHdr10Bit(string $pixFmt): bool
    {
        return preg_match('/(10|12)(le|be)$/', $pixFmt) === 1;
    }

    /**
     * §9.2's exit guard: re-read the row under `lockForUpdate()` immediately
     * before the final status write and abort if the speech (and its
     * cascade-deleted assets) vanished while ffmpeg was running — the whole
     * point being that a slow transcode racing a deletion must not resurrect
     * a row, or write into one a concurrent retry has already moved on from.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function writeFinalStatus(int $videoAssetId, array $attributes): void
    {
        DB::transaction(function () use ($videoAssetId, $attributes) {
            $current = SpeechAsset::query()->lockForUpdate()->find($videoAssetId);

            if ($current === null || $current->status !== 'processing') {
                return;
            }

            $current->update($attributes);
        });
    }

    private function downloadToLocalTemp(SpeechAsset $source): string
    {
        $local = tempnam(sys_get_temp_dir(), 'source_');
        file_put_contents($local, Storage::disk($source->disk)->get($source->path));

        return $local;
    }

    /**
     * @return array{codec_video: ?string, codec_audio: ?string, height: int, duration: float, pix_fmt: ?string}|null
     */
    private function probe(string $localPath): ?array
    {
        $result = Process::run([
            'ffprobe', '-v', 'error',
            '-print_format', 'json',
            '-show_entries', 'stream=codec_type,codec_name,height,pix_fmt:format=duration',
            $localPath,
        ]);

        if (! $result->successful()) {
            return null;
        }

        $data = json_decode($result->output(), true);

        if (! is_array($data)) {
            return null;
        }

        $video = null;
        $audio = null;

        foreach ($data['streams'] ?? [] as $stream) {
            if (($stream['codec_type'] ?? null) === 'video' && $video === null) {
                $video = $stream;
            }
            if (($stream['codec_type'] ?? null) === 'audio' && $audio === null) {
                $audio = $stream;
            }
        }

        return [
            'codec_video' => $video['codec_name'] ?? null,
            'codec_audio' => $audio['codec_name'] ?? null,
            'height' => (int) ($video['height'] ?? 0),
            'duration' => (float) ($data['format']['duration'] ?? 0),
            'pix_fmt' => $video['pix_fmt'] ?? null,
        ];
    }

    /**
     * @param  array{codec_video: ?string, codec_audio: ?string, height: int, duration: float, pix_fmt: ?string}  $probe
     */
    private function isRemuxCompatible(array $probe): bool
    {
        return $probe['codec_video'] === 'h264'
            && $probe['codec_audio'] === 'aac'
            && $probe['height'] > 0
            && $probe['height'] <= self::MAX_HEIGHT;
    }

    private function fail(SpeechAsset $videoAsset, string $code, string $detail): void
    {
        $this->writeFinalStatus($videoAsset->id, [
            'status' => 'failed',
            'failure_code' => $code,
            'failure_detail' => $detail,
        ]);
    }
}
