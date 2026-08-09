<?php

namespace App\Services\Transcoding;

use App\Models\SpeechAsset;

/**
 * Bound in testing/CI (App\Providers\AppServiceProvider) so upload-flow
 * tests never depend on real ffmpeg being present. Synchronously marks the
 * pending `video` asset `ready`, copying the source's path — good enough
 * for asserting the request/job/status wiring without exercising any real
 * media logic (that belongs to FfmpegTranscoder's own unit tests).
 */
class FakeTranscoder implements TranscoderContract
{
    public function transcode(SpeechAsset $videoAsset): void
    {
        $videoAsset->update([
            'status' => 'ready',
            'duration_seconds' => $videoAsset->duration_seconds ?? 1,
        ]);
    }
}
