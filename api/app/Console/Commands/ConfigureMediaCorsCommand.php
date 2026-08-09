<?php

namespace App\Console\Commands;

use Aws\S3\S3Client;
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
 */
class ConfigureMediaCorsCommand extends Command
{
    protected $signature = 'media:configure-cors';

    protected $description = "Apply the bucket CORS policy the browser's direct multipart PUTs need (§9.1).";

    public function handle(): int
    {
        $config = Config::get('filesystems.disks.media');

        $client = new S3Client([
            'version' => 'latest',
            'region' => $config['region'],
            'endpoint' => $config['endpoint'],
            'use_path_style_endpoint' => $config['use_path_style_endpoint'] ?? true,
            'credentials' => [
                'key' => $config['key'],
                'secret' => $config['secret'],
            ],
        ]);

        $origins = Config::get('cors.allowed_origins', []);

        $client->putBucketCors([
            'Bucket' => $config['bucket'],
            'CORSConfiguration' => [
                'CORSRules' => [[
                    'AllowedOrigins' => $origins ?: ['*'],
                    'AllowedMethods' => ['GET', 'PUT', 'POST'],
                    'AllowedHeaders' => ['*'],
                    'ExposeHeaders' => ['ETag'],
                    'MaxAgeSeconds' => 3000,
                ]],
            ],
        ]);

        $this->info('Bucket CORS configured, exposing ETag for '.implode(', ', $origins ?: ['*']).'.');

        return self::SUCCESS;
    }
}
