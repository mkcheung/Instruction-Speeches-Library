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
 *
 * PLAN-APP-HEADER.md W4 adds explicit rotation handling on top of the above
 * — but only for the METADATA path (persisting display-correct width/
 * height, see extractRotation()/displayDimensions()), not the encode path.
 * The remux (`-c copy`) and re-encode commands are unchanged; a rotated
 * source still relies on the player's/ffmpeg's own autorotate behavior to
 * actually display right-side-up. What changed is that the *numbers this
 * class writes to the database* now account for rotation, so a portrait
 * phone clip isn't persisted with landscape dimensions.
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

        if ($localSource === null) {
            $this->fail($videoAsset, 'storage_read_failed', 'We had trouble reading your uploaded file. Please try again.');

            return;
        }

        // Everything below owns scratch files, and `Process::timeout()->run()`
        // THROWS `ProcessTimedOutException` rather than returning an
        // unsuccessful result. Without this `finally`, an ffmpeg timeout
        // leaked the full-size source copy and the partial rendition
        // permanently — two of those and `hasEnoughFreeSpace()` below wedges
        // every subsequent transcode on the host with `insufficient_disk_space`,
        // since nothing ever reclaims them. `generatePoster()` already had
        // this shape; `transcode()` did not.
        try {
            $this->transcodeFromLocalSource($videoAsset, $source, $localSource);
        } finally {
            @unlink($localSource);
        }
    }

    /**
     * The body of `transcode()` once the source is on local disk, split out
     * purely so the caller's `finally` can own `$localSource` while this
     * method owns its own rendition scratch file.
     */
    private function transcodeFromLocalSource(SpeechAsset $videoAsset, SpeechAsset $source, string $localSource): void
    {
        $probe = $this->probe($localSource);

        if ($probe === null || $probe['codec_video'] === null) {
            $this->fail($videoAsset, 'probe_failed', 'ffprobe could not read the uploaded file.');

            return;
        }

        // Deterministic output path (§9.2): never a timestamp suffix, so
        // duplicate output is structurally impossible on retry.
        $outputPath = "speeches/{$videoAsset->speech->ulid}/{$videoAsset->speech->ulid}/720p.mp4";
        // ffmpeg infers the muxer from the `.mp4` suffix, so the raw
        // tempnam() path can't be used directly — but the placeholder it
        // created must be unlinked, or every run leaks a zero-byte file.
        // Same trap WhisperTranscriber documents having already hit.
        $tmpOutputBase = tempnam(sys_get_temp_dir(), 'transcode_');
        @unlink($tmpOutputBase);
        $tmpOutput = $tmpOutputBase.'.mp4';

        try {
            $this->runTranscodePipeline($videoAsset, $source, $localSource, $tmpOutput, $outputPath, $probe);
        } finally {
            @unlink($tmpOutputBase);
            @unlink($tmpOutput);
        }
    }

    /**
     * @param  array{codec_video: ?string, codec_audio: ?string, width: int, height: int, duration: float, pix_fmt: ?string, rotation: int}  $probe
     */
    private function runTranscodePipeline(SpeechAsset $videoAsset, SpeechAsset $source, string $localSource, string $tmpOutput, string $outputPath, array $probe): void
    {
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
            $this->fail($videoAsset, $failureCode, 'We had trouble processing this video. Please try again.');

            return;
        }

        if (! $this->uploadFromLocalFile($source->disk, $tmpOutput, $outputPath)) {
            $this->fail($videoAsset, 'storage_write_failed', 'We had trouble saving this video. Please try again.');

            return;
        }

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

        // W4 (PLAN-APP-HEADER.md): persist the video's own display
        // dimensions (rotation-corrected — see displayDimensions()) so the
        // frontend can seed --video-ar on first paint instead of waiting
        // for `loadedmetadata`, removing the 16:9-to-real-ratio layout
        // jump on portrait video. Source 1 (poster dimensions) already
        // covers the common case for free; this is the fallback for
        // posterless speeches.
        [$width, $height] = $this->displayDimensions($probe);

        $this->writeFinalStatus($videoAsset->id, [
            'status' => 'ready',
            'disk' => $source->disk,
            'path' => $outputPath,
            // Read from the local rendition we just uploaded, not back off
            // the remote disk: `FilesystemAdapter::size()` has no try/catch
            // at all, so `throw => false` does NOT protect it — it throws
            // `UnableToRetrieveMetadata` straight out of transcode() if the
            // object is missing. The bytes are identical either way.
            'byte_size' => (int) filesize($tmpOutput),
            'duration_seconds' => $probe['duration'],
            'width' => $width,
            'height' => $height,
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

        $localRenditionBase = tempnam(sys_get_temp_dir(), 'poster_src_');
        @unlink($localRenditionBase);
        $localRendition = $localRenditionBase.'.mp4';

        try {
            if (! $this->copyToLocalFile($videoAsset->disk, $videoAsset->path, $localRendition)) {
                Log::warning('Poster regeneration skipped: could not read the rendition from storage.', [
                    'video_asset_id' => $videoAsset->id,
                ]);

                return;
            }

            $this->runPosterPipeline($videoAsset, $localRendition, $explicitTimeSeconds, includeSprite: false);
        } catch (\Throwable $e) {
            Log::warning('Poster regeneration failed.', [
                'video_asset_id' => $videoAsset->id,
                'exception' => $e->getMessage(),
            ]);
        } finally {
            @unlink($localRenditionBase);
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

        // Every `tempnam(...).'.ext'` below unlinks its placeholder and
        // tracks BOTH paths: ffmpeg needs the suffix to infer the muxer,
        // but the extensionless file tempnam() actually created is real and
        // was previously never cleaned up — nine leaked inodes per
        // transcode+poster run, which a byte-based free-space watermark
        // never notices.
        $masterBase = tempnam(sys_get_temp_dir(), 'poster_master_');
        @unlink($masterBase);
        $masterPath = $masterBase.'.jpg';
        $localTemps[] = $masterBase;
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
                $localVariantBase = tempnam(sys_get_temp_dir(), 'poster_v_');
                @unlink($localVariantBase);
                $localVariant = $localVariantBase.'.'.$extension;
                $localTemps[] = $localVariantBase;
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
            $spriteBase = tempnam(sys_get_temp_dir(), 'sprite_');
            @unlink($spriteBase);
            $spriteLocal = $spriteBase.'.jpg';
            $localTemps[] = $spriteBase;
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
            // Posters have no visible failed state (§9.5), so a storage
            // write failure here drops that variant rather than writing a
            // row pointing at an object that isn't there. Previously the
            // ignored `put()` return let the next line's `size()` — which
            // `throw => false` does not protect — throw
            // `UnableToRetrieveMetadata` out of an otherwise-successful
            // transcode. Sized from the local file for the same reason.
            if (! $this->uploadFromLocalFile($disk, $variant['local'], $variant['path'])) {
                Log::warning('Poster pipeline: could not store a derived variant.', [
                    'video_asset_id' => $videoAsset->id,
                    'path' => $variant['path'],
                ]);
                $variant = null;

                continue;
            }

            $variant['byte_size'] = (int) filesize($variant['local']);
        }
        unset($variant);

        $allVariants = array_values(array_filter($allVariants));

        if ($allVariants === []) {
            $this->cleanupTemps($localTemps);
            Log::warning('Poster pipeline: every derived variant failed to store.', ['video_asset_id' => $videoAsset->id]);

            return;
        }

        // Only clear the kinds we actually have fresh replacements for:
        // 'poster' is always regenerated by this method, but 'sprite' is
        // only touched when $includeSprite produced one — a poster-only
        // regeneration (generatePoster()) must leave the existing sprite
        // row alone. Derived from the variants that SURVIVED the upload
        // loop, not from what was generated: a sprite that failed to store
        // must not delete the existing sprite row it cannot replace.
        $kindsToReplace = array_values(array_unique(array_column($allVariants, 'kind')));

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
     * @param  array{codec_video: ?string, codec_audio: ?string, width: int, height: int, duration: float, pix_fmt: ?string, rotation: int}  $probe
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

    /**
     * Streamed copy, not `Storage::get()` buffered whole into memory first
     * — the same fix WhisperTranscriber::transcribe() already documents,
     * applied here too. The worker image sets no `memory_limit` override
     * (Dockerfile only adds opcache.ini/uploads.ini), so PHP's 128M
     * default applies while `quota_bytes` defaults to 5 GiB with no
     * per-file cap: buffering a 300 MB source fataled the process before
     * ffmpeg was ever invoked, leaving the asset stuck `processing`.
     *
     * Returns null when the object could not be read in full. The old code
     * passed `get()`'s null straight into `file_put_contents`, which writes
     * a zero-byte file without complaint — so a transient storage outage
     * became a permanent `probe_failed`, blaming the speaker's upload for
     * a storage fault.
     */
    private function downloadToLocalTemp(SpeechAsset $source): ?string
    {
        $local = tempnam(sys_get_temp_dir(), 'source_');

        if (! $this->copyToLocalFile($source->disk, $source->path, $local, (int) ($source->byte_size ?? 0))) {
            @unlink($local);

            return null;
        }

        return $local;
    }

    /**
     * Streams a remote object onto local disk. Returns false when it could
     * not be read in full.
     *
     * `$expectedBytes > 0` additionally rejects a positive-but-short copy:
     * the faststart-muxed MP4s this pipeline produces often still decode
     * from a truncated prefix, so an unchecked short read would transcode
     * only the opening minutes of a speech and publish that as `ready`,
     * indistinguishable from a complete rendition.
     */
    private function copyToLocalFile(string $disk, string $remotePath, string $localPath, int $expectedBytes = 0): bool
    {
        $sourceStream = Storage::disk($disk)->readStream($remotePath);

        if ($sourceStream === null) {
            return false;
        }

        $localHandle = fopen($localPath, 'wb');

        if ($localHandle === false) {
            fclose($sourceStream);

            return false;
        }

        $copied = stream_copy_to_stream($sourceStream, $localHandle);
        fclose($localHandle);
        fclose($sourceStream);

        return $copied !== false && ($expectedBytes <= 0 || $copied === $expectedBytes);
    }

    /**
     * Streams a local file up to the media disk. Returns false when the
     * write failed — `throw => false` means `put()`/`writeStream()` report
     * failure by return value, and every ignored one of those in this class
     * used to resurface much later as an unrelated-looking exception.
     */
    private function uploadFromLocalFile(string $disk, string $localPath, string $remotePath): bool
    {
        $handle = fopen($localPath, 'rb');

        if ($handle === false) {
            return false;
        }

        $written = Storage::disk($disk)->writeStream($remotePath, $handle);

        if (is_resource($handle)) {
            fclose($handle);
        }

        return $written !== false;
    }

    /**
     * @return array{codec_video: ?string, codec_audio: ?string, width: int, height: int, duration: float, pix_fmt: ?string, rotation: int}|null
     */
    private function probe(string $localPath): ?array
    {
        // W4 (PLAN-APP-HEADER.md): `width` added alongside the pre-existing
        // `height` so the video asset's own dimensions can be persisted
        // (writeFinalStatus below), not just used for the >1080p compliance
        // check. `side_data_list` and the `rotate` tag are both requested
        // because rotation can be signalled either way — a display-matrix
        // side data entry (modern muxers) or the legacy `rotate` tag — and
        // this is CODED width/height, before any rotation is applied; see
        // extractRotation()/displayDimensions() below for why persisting
        // these two numbers unmodified would be wrong for rotated phone
        // video.
        $result = Process::run([
            'ffprobe', '-v', 'error',
            '-print_format', 'json',
            '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,side_data_list:stream_tags=rotate:format=duration',
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
            'width' => (int) ($video['width'] ?? 0),
            'height' => (int) ($video['height'] ?? 0),
            'duration' => (float) ($data['format']['duration'] ?? 0),
            'pix_fmt' => $video['pix_fmt'] ?? null,
            'rotation' => $video !== null ? $this->extractRotation($video) : 0,
        ];
    }

    /**
     * W4's rotation trap: ffprobe's `stream=width,height` is CODED
     * dimensions, unaffected by a rotate-90 display matrix on a `-c copy`
     * remux (§9.5 — an iPhone clip stored 1920x1080 with a rotation flag
     * keeps that flag; the browser reports `videoWidth/Height` as the
     * rotated 1080x1920). Persisting coded dimensions unmodified would
     * reserve a landscape box for portrait content, reintroducing the
     * exact layout jump W4 exists to remove — while a naive "dimensions
     * are non-null" test would still pass.
     *
     * Checks the modern side-data form first (a "Display Matrix" entry
     * carrying a `rotation` field, degrees, ffmpeg >= 4.x), then falls
     * back to the legacy `rotate` stream tag some muxers still use.
     * Normalizes to one of 0/90/180/270 — side-data rotation can be
     * reported as a signed value (e.g. -90 for a clockwise phone turn) or
     * outside [0,360), and anything that doesn't land on a right angle is
     * treated as unrotated rather than guessed at.
     *
     * @param  array<string, mixed>  $video
     */
    private function extractRotation(array $video): int
    {
        $rotation = null;

        foreach ($video['side_data_list'] ?? [] as $sideData) {
            if (is_array($sideData) && array_key_exists('rotation', $sideData)) {
                $rotation = (int) $sideData['rotation'];
                break;
            }
        }

        if ($rotation === null && isset($video['tags']['rotate'])) {
            $rotation = (int) $video['tags']['rotate'];
        }

        if ($rotation === null) {
            return 0;
        }

        $normalized = (($rotation % 360) + 360) % 360;

        return in_array($normalized, [90, 180, 270], true) ? $normalized : 0;
    }

    /**
     * Swaps the coded width/height when the stream is rotated a quarter
     * turn either way — the display orientation a browser will actually
     * decode to (W4). 180-degree rotation does not swap axes.
     *
     * @param  array{width: int, height: int, rotation: int}  $probe
     * @return array{0: int|null, 1: int|null}
     */
    private function displayDimensions(array $probe): array
    {
        $width = $probe['width'] > 0 ? $probe['width'] : null;
        $height = $probe['height'] > 0 ? $probe['height'] : null;

        if ($width === null || $height === null) {
            return [null, null];
        }

        return in_array($probe['rotation'], [90, 270], true)
            ? [$height, $width]
            : [$width, $height];
    }

    /**
     * @param  array{codec_video: ?string, codec_audio: ?string, width: int, height: int, duration: float, pix_fmt: ?string, rotation: int}  $probe
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
