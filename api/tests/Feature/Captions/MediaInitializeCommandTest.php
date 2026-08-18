<?php

use App\Console\Commands\ConfigureMediaCorsCommand;
use App\Services\MediaS3ClientFactory;
use Aws\Command;
use Aws\MockHandler;
use Aws\Result;
use Aws\S3\Exception\S3Exception;
use Aws\S3\S3Client;
use GuzzleHttp\Psr7\Response;

/**
 * STEP-09 E2E verification plan §3.2: `media:initialize` must (1) create the
 * configured bucket when absent, (2) apply the existing CORS policy —
 * including exposed `ETag` — and (3) succeed unchanged when run again.
 *
 * Uses `Aws\MockHandler` (the AWS SDK's own test seam, queueing
 * `Aws\ResultInterface`/`Aws\Exception\AwsException` responses per call)
 * rather than a real SeaweedFS endpoint, injected through the new
 * `MediaS3ClientFactory` container binding — no Docker/network required.
 */
function mediaInitializeFakeS3Client(MockHandler $handler): S3Client
{
    return new S3Client([
        'version' => 'latest',
        'region' => 'us-east-1',
        'credentials' => ['key' => 'test-key', 'secret' => 'test-secret'],
        'handler' => $handler,
    ]);
}

function mediaInitializeNotFoundError(string $operation): S3Exception
{
    return new S3Exception(
        'Not Found',
        new Command($operation),
        ['response' => new Response(404), 'code' => 'NotFound']
    );
}

test('creates the bucket when absent and applies the CORS policy', function () {
    $handler = new MockHandler;
    $handler->append(mediaInitializeNotFoundError('HeadBucket'));         // bucket does not exist yet
    $handler->append(new Result);                      // CreateBucket succeeds
    $handler->append(new Result);                      // PutBucketCors succeeds

    app()->instance(MediaS3ClientFactory::class, new MediaS3ClientFactory(mediaInitializeFakeS3Client($handler)));

    $this->artisan('media:initialize')
        ->expectsOutputToContain('created')
        ->expectsOutputToContain('CORS policy applied')
        ->assertSuccessful();

    expect($handler)->toHaveCount(0);
});

test('is idempotent when the bucket already exists', function () {
    $handler = new MockHandler;
    $handler->append(new Result);                       // HeadBucket succeeds: bucket already exists
    $handler->append(new Result);                       // PutBucketCors succeeds

    app()->instance(MediaS3ClientFactory::class, new MediaS3ClientFactory(mediaInitializeFakeS3Client($handler)));

    $this->artisan('media:initialize')
        ->expectsOutputToContain('already exists')
        ->expectsOutputToContain('CORS policy applied')
        ->assertSuccessful();

    expect($handler)->toHaveCount(0);
});

test('treats a concurrent BucketAlreadyOwnedByYou create race as success, not failure', function () {
    $handler = new MockHandler;
    $handler->append(mediaInitializeNotFoundError('HeadBucket'));
    $handler->append(new S3Exception(
        'Bucket already owned by you',
        new Command('CreateBucket'),
        ['response' => new Response(409), 'code' => 'BucketAlreadyOwnedByYou']
    ));
    $handler->append(new Result); // PutBucketCors

    app()->instance(MediaS3ClientFactory::class, new MediaS3ClientFactory(mediaInitializeFakeS3Client($handler)));

    $this->artisan('media:initialize')
        ->expectsOutputToContain('already exists (created concurrently)')
        ->assertSuccessful();
});

test('applies the extended CORS rule exposing ETag and range-delivery headers', function () {
    $rule = ConfigureMediaCorsCommand::corsRule(['https://app.speechcoach.test']);

    expect($rule['AllowedMethods'])->toContain('HEAD');
    expect($rule['ExposeHeaders'])->toEqual(['ETag', 'Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type']);
});
