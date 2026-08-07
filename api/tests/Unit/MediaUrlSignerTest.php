<?php

use App\Services\MediaUrlSigner;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

test('presign asks the media disk for a temporary url with the default 10-minute ttl', function () {
    Carbon::setTestNow('2026-01-01 00:00:00');

    $fake = Mockery::mock(FilesystemAdapter::class);
    $fake->shouldReceive('temporaryUrl')
        ->once()
        ->withArgs(function (string $path, $expiration) {
            return $path === 'speeches/01ABC/video.mp4'
                && $expiration->equalTo(Carbon::now()->addSeconds(600));
        })
        ->andReturn('https://example.test/signed');

    Storage::shouldReceive('disk')->with('media_public')->andReturn($fake);

    $url = (new MediaUrlSigner)->presign('speeches/01ABC/video.mp4');

    expect($url)->toBe('https://example.test/signed');

    Carbon::setTestNow();
});

test('presign accepts a custom ttl', function () {
    Carbon::setTestNow('2026-01-01 00:00:00');

    $fake = Mockery::mock(FilesystemAdapter::class);
    $fake->shouldReceive('temporaryUrl')
        ->once()
        ->withArgs(function (string $path, $expiration) {
            return $expiration->equalTo(Carbon::now()->addSeconds(3600));
        })
        ->andReturn('https://example.test/signed-poster');

    Storage::shouldReceive('disk')->with('media_public')->andReturn($fake);

    $url = (new MediaUrlSigner)->presign('speeches/01ABC/poster.jpg', 3600);

    expect($url)->toBe('https://example.test/signed-poster');

    Carbon::setTestNow();
});
