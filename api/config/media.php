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

    /*
    |--------------------------------------------------------------------------
    | Takedown media quarantine (PLAN-ADMIN-DASHBOARD §5.6, §11.2)
    |--------------------------------------------------------------------------
    |
    | How long a taken-down speech's media survives at storage before
    | App\Jobs\PurgeSpeechMedia deletes the bytes for good. Read by that job
    | (which re-checks the window itself, so no dispatch site can shorten it)
    | and by `media:reconcile`'s nightly sweep, which selects on exactly the
    | same threshold.
    |
    | 30 days, matching the user soft-delete grace period: §11.2's recommended
    | answer to "immediate hard delete, or quarantine?" — a wrongful takedown
    | has to be recoverable, and restore (§6.3) is worthless if the bytes are
    | already gone. The stated cost of that choice, per §11.2: a 1-hour
    | unrevocable presigned URL plus this window means taken-down content
    | stays retrievable to someone holding a fresh URL for up to 30 days.
    | Lowering this trades recoverability for faster removal; 0 is NOT a
    | supported "purge immediately" switch — a speech restored in the same
    | minute would already have lost its media, and the sweep only runs
    | nightly, so the real floor is one scheduler tick.
    |
    | A config value rather than a constant in the job specifically because
    | this is the number a legal/abuse-policy change moves (§11.1's unaddressed
    | groundwork), and it should move without touching purge code.
    |
    */
    'takedown_quarantine_days' => (int) env('MEDIA_TAKEDOWN_QUARANTINE_DAYS', 30),

];
