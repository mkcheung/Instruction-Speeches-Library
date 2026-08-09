<?php

namespace App\Services\Transcoding;

use App\Models\SpeechAsset;
use Illuminate\Support\Facades\DB;

/**
 * Bound in testing/CI (App\Providers\AppServiceProvider) so upload-flow
 * tests never depend on real ffmpeg being present. Synchronously marks the
 * pending `video` asset `ready`, copying the source's path — good enough
 * for asserting the request/job/status wiring without exercising any real
 * media logic (that belongs to FfmpegTranscoder's own unit tests).
 *
 * STEP-04: also fakes a minimal poster row so tests elsewhere that assert
 * "a ready video has a primary poster" don't need real ffmpeg either. It
 * deliberately only creates the one primary 640w webp row — not the full
 * six-variant/sprite set FfmpegTranscoder produces — since this class
 * exists to stand in for the wiring, not the media pipeline itself.
 */
class FakeTranscoder implements TranscoderContract
{
    public function transcode(SpeechAsset $videoAsset): void
    {
        $videoAsset->update([
            'status' => 'ready',
            'duration_seconds' => $videoAsset->duration_seconds ?? 1,
        ]);

        $this->generatePoster($videoAsset, null);
    }

    public function generatePoster(SpeechAsset $videoAsset, ?float $explicitTimeSeconds): void
    {
        $videoAsset = $videoAsset->fresh() ?? $videoAsset;
        $duration = (float) ($videoAsset->duration_seconds ?? 1);

        $seekSeconds = $explicitTimeSeconds !== null
            ? max(0.0, min($explicitTimeSeconds, $duration))
            : max(2.0, min(0.10 * $duration, 30.0));
        $seekSeconds = max(0.0, min($seekSeconds, $duration));

        $timeMs = (int) round($seekSeconds * 1000);
        $ulid = $videoAsset->speech->ulid;

        DB::transaction(function () use ($videoAsset, $timeMs, $ulid, $seekSeconds) {
            // Same delete-then-insert-in-one-transaction shape
            // FfmpegTranscoder uses, for the same reason: clearing the old
            // primary poster row and inserting the new one atomically is
            // what keeps `uq_assets_primary` from rejecting the insert.
            SpeechAsset::query()
                ->where('speech_id', $videoAsset->speech_id)
                ->where('kind', 'poster')
                ->delete();

            SpeechAsset::query()->create([
                'speech_id' => $videoAsset->speech_id,
                'kind' => 'poster',
                'format' => 'webp',
                'disk' => $videoAsset->disk,
                'path' => "speeches/{$ulid}/{$ulid}/poster/{$timeMs}/640.webp",
                'status' => 'ready',
                'is_primary' => true,
                'width' => 640,
                'height' => 360,
                'poster_time_seconds' => $seekSeconds,
            ]);
        });
    }
}
