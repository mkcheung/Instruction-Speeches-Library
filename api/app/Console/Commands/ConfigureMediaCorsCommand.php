<?php

namespace App\Console\Commands;

use App\Services\MediaS3ClientFactory;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Config;

/**
 * §9.1: "Bucket CORS must expose `ETag` or multipart completion fails
 * silently." The browser PUTs each part directly to SeaweedFS via a
 * presigned URL (App\Services\MultipartUploadService); without this policy
 * the browser's `fetch`/`XHR` response strips the `ETag` header as
 * cross-origin (app.speechcoach.test → localhost:8333), and Uppy has no
 * part ETag to hand back to `completeMultipartUpload`.
 *
 * One-shot, idempotent (PutBucketCors overwrites, not appends) — run once
 * per fresh SeaweedFS volume: `docker compose exec app php artisan
 * media:configure-cors`. Not part of the app's request lifecycle, so it is
 * a console command rather than boot-time code.
 *
 * STEP-09 E2E verification plan §3.2 extends this rule with `HEAD` and the
 * Range-delivery response headers (`Content-Range`, `Accept-Ranges`,
 * `Content-Length`, `Content-Type`) alongside the existing `ETag` exposure,
 * so a presigned GET/HEAD/byte-range request against the media proxy also
 * clears the browser's cross-origin header allowlist. `media:initialize`
 * (App\Console\Commands\MediaInitializeCommand) calls this same rule
 * builder so the two commands cannot drift.
 */
class ConfigureMediaCorsCommand extends Command
{
    protected $signature = 'media:configure-cors';

    protected $description = "Apply the bucket CORS policy the browser's direct multipart PUTs and media playback need (§9.1, STEP-09 §3.2).";

    public function __construct(private readonly MediaS3ClientFactory $clients)
    {
        parent::__construct();
    }

    /**
     * Shared with `MediaInitializeCommand` so the E2E bucket-initializer
     * and the standalone `media:configure-cors` command can never apply
     * two different policies to the same bucket.
     */
    public static function corsRule(array $origins): array
    {
        return [
            'AllowedOrigins' => $origins ?: ['*'],
            'AllowedMethods' => ['GET', 'PUT', 'POST', 'HEAD'],
            'AllowedHeaders' => ['*'],
            'ExposeHeaders' => ['ETag', 'Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
            'MaxAgeSeconds' => 3000,
        ];
    }

    public function handle(): int
    {
        $config = Config::get('filesystems.disks.media');
        $client = $this->clients->make('media');
        $origins = Config::get('cors.allowed_origins', []);

        $client->putBucketCors([
            'Bucket' => $config['bucket'],
            'CORSConfiguration' => [
                'CORSRules' => [self::corsRule($origins)],
            ],
        ]);

        $this->info('Bucket CORS configured, exposing ETag/Range headers for '.implode(', ', $origins ?: ['*']).'.');

        return self::SUCCESS;
    }
}
