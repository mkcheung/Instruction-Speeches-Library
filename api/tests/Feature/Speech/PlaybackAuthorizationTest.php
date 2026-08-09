<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-03 acceptance: "A second Member cannot fetch it, verified by hitting
 * the presigned URL directly" — the playback-url endpoint itself must
 * refuse a non-owner (the presigned URL it would otherwise hand out is a
 * standing grant for its TTL, so the refusal has to happen before signing).
 * Mocks the Storage facade the same way PresignEndpointTest/MediaUrlSignerTest
 * do, since real SeaweedFS isn't reachable here.
 */
it('returns a presigned playback URL to the owner of a ready asset', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $asset = SpeechAsset::factory()->for($speech)->video()->ready()->create(['path' => 'speeches/01ABC/video.mp4']);

    $fake = Mockery::mock(FilesystemAdapter::class);
    $fake->shouldReceive('temporaryUrl')
        ->once()
        ->withArgs(fn (string $path) => $path === 'speeches/01ABC/video.mp4')
        ->andReturn('https://seaweedfs.test/media/speeches/01ABC/video.mp4?X-Amz-Signature=fake');
    Storage::shouldReceive('disk')->with('media_public')->andReturn($fake);

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}/assets/{$asset->id}/playback-url");

    $response->assertOk();
    $response->assertJsonPath('url', 'https://seaweedfs.test/media/speeches/01ABC/video.mp4?X-Amz-Signature=fake');
});

it('refuses a second Member hitting the playback-url endpoint for someone else\'s speech', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $asset = SpeechAsset::factory()->for($speech)->video()->ready()->create();

    Storage::shouldReceive('disk')->with('media_public')->never();

    $response = $this->actingAs($other)->getJson("/api/speeches/{$speech->id}/assets/{$asset->id}/playback-url");

    $response->assertNotFound();
});

it('refuses a playback URL for an asset that is not yet ready', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $asset = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}/assets/{$asset->id}/playback-url");

    $response->assertNotFound();
});
