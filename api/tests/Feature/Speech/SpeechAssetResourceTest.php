<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-04-every-video-plays.md §9.5: `poster`/`sprite` on SpeechResource,
 * and the new `width`/`height`/`poster_time_seconds` fields on
 * SpeechAssetResource. Storage is mocked the same way
 * PlaybackAuthorizationTest/PresignEndpointTest do it — real SeaweedFS isn't
 * reachable here — so every presign just needs to return SOME URL, not a
 * specific one, except where the test is pinning shape.
 */
function fakeMediaDisk(): void
{
    $fake = Mockery::mock(FilesystemAdapter::class);
    $fake->shouldReceive('temporaryUrl')
        ->andReturnUsing(fn (string $path) => "https://seaweedfs.test/media/{$path}?X-Amz-Signature=fake");
    Storage::shouldReceive('disk')->with('media_public')->andReturn($fake);
}

it('includes poster and sprite blocks when ready primary rows exist', function () {
    fakeMediaDisk();

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    SpeechAsset::factory()->for($speech)->video()->ready()->create(['duration_seconds' => 42.5]);
    $primaryPoster = SpeechAsset::factory()->for($speech)->poster()->create([
        'status' => 'ready',
        'is_primary' => true,
        'width' => 1280,
        'height' => 720,
    ]);
    $smallPoster = SpeechAsset::factory()->for($speech)->poster()->create([
        'status' => 'ready',
        'is_primary' => false,
        'width' => 640,
        'height' => 360,
        'format' => 'webp',
    ]);
    SpeechAsset::factory()->for($speech)->sprite()->create([
        'status' => 'ready',
        'width' => 800,
        'height' => 180,
    ]);

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}");

    $response->assertOk();
    $response->assertJsonPath('speech.poster.width', 1280);
    $response->assertJsonPath('speech.poster.height', 720);
    expect($response->json('speech.poster.url'))->toContain($primaryPoster->path);
    expect($response->json('speech.poster.variants'))->toHaveCount(2);
    expect(collect($response->json('speech.poster.variants'))->pluck('width')->all())
        ->toEqualCanonicalizing([1280, 640]);
    expect(collect($response->json('speech.poster.variants'))->firstWhere('width', 640)['format'])
        ->toBe('webp');
    expect($smallPoster)->not->toBeNull();

    $response->assertJsonPath('speech.sprite.columns', 5);
    $response->assertJsonPath('speech.sprite.rows', 2);
    $response->assertJsonPath('speech.sprite.frame_width', 800);
    $response->assertJsonPath('speech.sprite.frame_height', 180);
    $response->assertJsonPath('speech.sprite.duration_seconds', '42.500');
});

it('omits poster and sprite entirely when no ready rows exist, without crashing', function () {
    fakeMediaDisk();

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    SpeechAsset::factory()->for($speech)->video()->ready()->create();
    // A processing (not-yet-ready) poster must not surface.
    SpeechAsset::factory()->for($speech)->poster()->create(['status' => 'processing', 'is_primary' => true]);

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}");

    $response->assertOk();
    expect($response->json('speech'))->not->toHaveKey('poster');
    expect($response->json('speech'))->not->toHaveKey('sprite');
});

it('exposes width/height/poster_time_seconds on SpeechAssetResource for a poster row', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $video = SpeechAsset::factory()->for($speech)->video()->ready()->create(['poster_time_seconds' => 3.25]);

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}");

    $response->assertOk();
    $response->assertJsonPath('speech.primary_video.poster_time_seconds', '3.250');
    expect($video)->not->toBeNull();
});
