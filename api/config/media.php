<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Free-space watermark (R10)
    |--------------------------------------------------------------------------
    |
    | A blunt, GLOBAL guard — not a per-file check — consulted by
    | App\Services\Transcoding\FfmpegTranscoder before starting ANY ffmpeg
    | work, in both transcode() and generatePoster(). It compares
    | disk_free_space() on the same local filesystem downloadToLocalTemp()
    | and the poster pipeline write their scratch files to
    | (sys_get_temp_dir()) against this threshold. Below it, transcode()
    | fails the video asset with failure_code 'insufficient_disk_space'
    | without ever invoking ffmpeg; generatePoster() is a silent no-op
    | (posters have no visible "failed" state — see MODERNIZATION_PLAN
    | §9.5, "no poster is a designed state, not a broken image").
    |
    | Default 2 GiB, matching MODERNIZATION_PLAN §13 R10's own example
    | figure: comfortable headroom for one source download plus a re-encoded
    | rendition plus poster/sprite scratch files on the concurrency-1 worker
    | §9.2 assumes, while still tripping well before a small VPS volume is
    | actually full.
    |
    */
    'free_space_watermark_bytes' => (int) env('MEDIA_FREE_SPACE_WATERMARK_BYTES', 2 * 1024 * 1024 * 1024),

];
