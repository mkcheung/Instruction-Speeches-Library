<?php

use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

test('GET /api/spikes/presign returns a presigned url for the given path', function () {
    $fake = Mockery::mock(FilesystemAdapter::class);
    $fake->shouldReceive('temporaryUrl')
        ->once()
        ->withArgs(fn (string $path, $expiration) => $path === 'speeches/01ABC/video.mp4')
        ->andReturn('https://seaweedfs.test/media/speeches/01ABC/video.mp4?X-Amz-Signature=fake');

    Storage::shouldReceive('disk')->with('media_public')->andReturn($fake);

    $response = $this->getJson('/api/spikes/presign?path=speeches/01ABC/video.mp4');

    $response
        ->assertOk()
        ->assertJson([
            'url' => 'https://seaweedfs.test/media/speeches/01ABC/video.mp4?X-Amz-Signature=fake',
        ]);
});

test('GET /api/spikes/presign requires a path', function () {
    $response = $this->getJson('/api/spikes/presign');

    $response->assertUnprocessable();
});
