<?php

namespace App\Services\Transcoding;

use App\Models\SpeechAsset;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * The dev binding (App\Providers\AppServiceProvider). STEP-03 is
 * deliberately **remux-only** — the full HEVC/HDR/rotation pipeline is
 * STEP-04's job. This handles exactly the case STEP-03's acceptance list
 * requires ("a compliant H.264 file plays") and fails everything else
 * visibly, which is the point: an unmodified iPhone .MOV must land in a
 * real Failed state now, standing in for STEP-04's feature.
 *
 * On macOS, Docker Desktop cannot pass through VideoToolbox (§21.3) — which
 * is exactly why remux-only ships first: `-c copy` takes about a second
 * regardless of host hardware.
 */
class FfmpegTranscoder implements TranscoderContract
{
    private const MAX_HEIGHT = 1080;

    public function transcode(SpeechAsset $videoAsset): void
    {
        $source = $videoAsset->speech->assets()->where('kind', 'source')->first();

        if ($source === null) {
            $this->fail($videoAsset, 'source_missing', 'No source asset found for this speech.');

            return;
        }

        $localSource = $this->downloadToLocalTemp($source);
        $probe = $this->probe($localSource);

        if ($probe === null) {
            @unlink($localSource);
            $this->fail($videoAsset, 'probe_failed', 'ffprobe could not read the uploaded file.');

            return;
        }

        if (! $this->isRemuxCompatible($probe)) {
            @unlink($localSource);
            $this->fail($videoAsset, 'unsupported_format', "We can't process this format yet. Please upload an H.264/AAC MP4 under 1080p.");

            return;
        }

        // Deterministic output path (§9.2): never a timestamp suffix, so
        // duplicate output is structurally impossible on retry.
        $outputPath = "speeches/{$videoAsset->speech->ulid}/{$videoAsset->speech->ulid}/720p.mp4";
        $tmpOutput = tempnam(sys_get_temp_dir(), 'remux_').'.mp4';

        $result = Process::run([
            'ffmpeg', '-nostdin', '-y',
            '-i', $localSource,
            '-c', 'copy',
            '-movflags', '+faststart',
            $tmpOutput,
        ]);

        @unlink($localSource);

        if (! $result->successful()) {
            @unlink($tmpOutput);
            $this->fail($videoAsset, 'remux_failed', 'We had trouble processing this video. Please try again.');

            return;
        }

        Storage::disk($source->disk)->put($outputPath, file_get_contents($tmpOutput));
        @unlink($tmpOutput);

        $this->writeFinalStatus($videoAsset->id, [
            'status' => 'ready',
            'disk' => $source->disk,
            'path' => $outputPath,
            'byte_size' => Storage::disk($source->disk)->size($outputPath),
            'duration_seconds' => $probe['duration'],
        ]);
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
     * @return array{codec_video: ?string, codec_audio: ?string, height: int, duration: float}|null
     */
    private function probe(string $localPath): ?array
    {
        $result = Process::run([
            'ffprobe', '-v', 'error',
            '-print_format', 'json',
            '-show_entries', 'stream=codec_type,codec_name,height:format=duration',
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
        ];
    }

    /**
     * @param  array{codec_video: ?string, codec_audio: ?string, height: int, duration: float}  $probe
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
