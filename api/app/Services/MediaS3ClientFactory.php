<?php

namespace App\Services;

use Aws\S3\S3Client;
use Illuminate\Support\Facades\Config;

/**
 * The single place an `Aws\S3\S3Client` is built from `filesystems.disks.*`
 * config, extracted out of `ConfigureMediaCorsCommand`'s previous inline
 * construction (`App\Console\Commands\ConfigureMediaCorsCommand`) so
 * `media:initialize` (STEP-09 E2E harness) can share the exact same
 * credentials/endpoint wiring instead of a second copy that could drift.
 *
 * Bound in the container (not `new`'d directly by callers) purely so tests
 * can substitute a client wired with `Aws\MockHandler` — see
 * `MediaInitializeCommandTest` — without a real SeaweedFS/S3 endpoint.
 */
class MediaS3ClientFactory
{
    public function __construct(private readonly ?S3Client $override = null) {}

    public function make(string $disk = 'media'): S3Client
    {
        if ($this->override !== null) {
            return $this->override;
        }

        $config = Config::get("filesystems.disks.{$disk}");

        return new S3Client([
            'version' => 'latest',
            'region' => $config['region'],
            'endpoint' => $config['endpoint'],
            'use_path_style_endpoint' => $config['use_path_style_endpoint'] ?? true,
            'credentials' => [
                'key' => $config['key'],
                'secret' => $config['secret'],
            ],
        ]);
    }
}
