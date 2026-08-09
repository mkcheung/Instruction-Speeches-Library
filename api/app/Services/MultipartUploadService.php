<?php

namespace App\Services;

use Aws\S3\S3Client;
use Illuminate\Support\Facades\Config;

/**
 * §9.1: presigned S3 multipart against SeaweedFS — create / sign-part /
 * complete / abort, four endpoints, each a pure S3 call, so pointing at
 * real S3 later changes nothing (§9.4's "config" seam).
 *
 * Two `S3Client`s, same split reason as MediaUrlSigner (§9.3's doc-block):
 * `createMultipartUpload`/`completeMultipartUpload`/`abortMultipartUpload`
 * are server-to-store calls and use the `media` disk's internal endpoint;
 * signing an `UploadPart` URL must happen against the `media_public`
 * disk's browser-reachable endpoint, or the SigV4 signature covers a host
 * nothing outside the container can send to.
 */
class MultipartUploadService
{
    private S3Client $internalClient;

    private S3Client $publicClient;

    private string $bucket;

    public function __construct()
    {
        $this->internalClient = $this->makeClient('media');
        $this->publicClient = $this->makeClient('media_public');
        $this->bucket = (string) Config::get('filesystems.disks.media.bucket');
    }

    private function makeClient(string $disk): S3Client
    {
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

    public function create(string $key, string $contentType): string
    {
        $result = $this->internalClient->createMultipartUpload([
            'Bucket' => $this->bucket,
            'Key' => $key,
            'ContentType' => $contentType,
        ]);

        return $result['UploadId'];
    }

    /**
     * A presigned PUT URL for a single part. `expiresIn` matches the
     * playback GET TTL's spirit — long enough for a slow phone connection
     * to push one ~5-6 MB part, short enough not to be a standing grant.
     */
    public function signPart(string $key, string $uploadId, int $partNumber, int $expiresInSeconds = 900): string
    {
        $command = $this->publicClient->getCommand('UploadPart', [
            'Bucket' => $this->bucket,
            'Key' => $key,
            'UploadId' => $uploadId,
            'PartNumber' => $partNumber,
        ]);

        return (string) $this->publicClient->createPresignedRequest($command, "+{$expiresInSeconds} seconds")
            ->getUri();
    }

    /**
     * @param  list<array{PartNumber: int, ETag: string}>  $parts
     * @return array{byte_size: int}
     */
    public function complete(string $key, string $uploadId, array $parts): array
    {
        $this->internalClient->completeMultipartUpload([
            'Bucket' => $this->bucket,
            'Key' => $key,
            'UploadId' => $uploadId,
            'MultipartUpload' => ['Parts' => $parts],
        ]);

        $head = $this->internalClient->headObject([
            'Bucket' => $this->bucket,
            'Key' => $key,
        ]);

        return ['byte_size' => (int) $head['ContentLength']];
    }

    public function abort(string $key, string $uploadId): void
    {
        $this->internalClient->abortMultipartUpload([
            'Bucket' => $this->bucket,
            'Key' => $key,
            'UploadId' => $uploadId,
        ]);
    }
}
