<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;

/**
 * The one place application code is allowed to turn an object-storage path
 * into a URL a browser can hit directly (§9.4 rule 1: "No application code
 * ever constructs a media URL — everything through MediaUrlSigner").
 *
 * Backed by the "media" disk (S3-compatible, SeaweedFS in dev/CI — §9.4's
 * config seam), using Laravel's native S3 temporaryUrl support so that
 * SigV4 query-string presigning signs only `host`, leaving `Range` free for
 * the browser to add on every seek (§9.3).
 */
class MediaUrlSigner
{
    /**
     * Default TTL for video/audio playback URLs: 10 minutes (§9.3).
     * Posters get a longer TTL (1 hour, §9.5) because there is no
     * seek-refresh mechanism behind an <img>.
     */
    public const DEFAULT_TTL_SECONDS = 600;

    /**
     * `media_public` shares every credential and bucket with `media` and
     * differs only in `endpoint` (config/filesystems.php) — signing must
     * happen against the host a browser can actually reach, which is not
     * necessarily the same address the container uses internally (e.g.
     * `seaweedfs:8333` inside compose vs `localhost:8333` published to the
     * host). Signing against the wrong one produces a URL whose SigV4
     * signature covers a `Host` header nothing outside the container can
     * send.
     */
    public function __construct(private readonly string $disk = 'media_public') {}

    /**
     * Produce a presigned GET URL for the given object path, valid for
     * Range requests (video/audio seeking) until it expires.
     */
    public function presign(string $path, int $ttlSeconds = self::DEFAULT_TTL_SECONDS): string
    {
        return Storage::disk($this->disk)->temporaryUrl(
            $path,
            now()->addSeconds($ttlSeconds),
        );
    }
}
