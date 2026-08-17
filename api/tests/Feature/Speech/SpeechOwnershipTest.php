<?php

use App\Jobs\GenerateCaptions;
use App\Jobs\TranscodeSpeechAsset;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\MultipartUploadService;
use Illuminate\Support\Facades\Queue;

/**
 * Every read/write surface in SpeechController and SpeechUploadController
 * must refuse a non-owner. STEP-03's acceptance item ("a second Member
 * cannot fetch it") is proven for the playback-url endpoint in
 * PlaybackAuthorizationTest and for create/complete/abort in
 * UploadFlowTest; this file closes the remaining endpoints.
 */
it('index only ever returns the requesting user\'s own speeches', function () {
    $user = User::factory()->create();
    $other = User::factory()->create();
    Speech::factory()->for($user)->create(['title' => 'Mine']);
    Speech::factory()->for($other)->create(['title' => 'Not mine']);

    $response = $this->actingAs($user)->getJson('/api/speeches');

    $response->assertOk();
    expect($response->json('speeches'))->toHaveCount(1);
    expect($response->json('speeches.0.title'))->toBe('Mine');
});

it('refuses show for a speech owned by someone else', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $this->actingAs($other)->getJson("/api/speeches/{$speech->id}")->assertNotFound();
    $this->actingAs($owner)->getJson("/api/speeches/{$speech->id}")->assertOk();
});

it('refuses signPart for a non-owner', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $asset = SpeechAsset::factory()->for($speech)->create(['upload_id' => 'x']);

    $this->mock(MultipartUploadService::class, function ($mock) {
        $mock->shouldReceive('signPart')->never();
    });

    $this->actingAs($other)
        ->postJson("/api/speeches/{$speech->id}/assets/{$asset->id}/uploads/x/parts/1")
        ->assertNotFound();
});

it('signs a part for the owner', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $asset = SpeechAsset::factory()->for($speech)->create(['upload_id' => 'x']);

    $this->mock(MultipartUploadService::class, function ($mock) {
        $mock->shouldReceive('signPart')->once()->andReturn('https://signed.example/part-1');
    });

    $response = $this->actingAs($user)
        ->postJson("/api/speeches/{$speech->id}/assets/{$asset->id}/uploads/x/parts/1");

    $response->assertOk();
    $response->assertJsonPath('url', 'https://signed.example/part-1');
});

it('refuses retry for a non-owner, and for an asset that is not a failed video', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $failedVideo = SpeechAsset::factory()->for($speech)->video()->failed()->create();
    $readyVideo = SpeechAsset::factory()->for($speech)->video()->ready()->create();

    $this->actingAs($other)
        ->postJson("/api/speeches/{$speech->id}/assets/{$failedVideo->id}/retry")
        ->assertNotFound();

    $this->actingAs($owner)
        ->postJson("/api/speeches/{$speech->id}/assets/{$readyVideo->id}/retry")
        ->assertNotFound(); // not failed — nothing to retry
});

it('refuses retry of a failed captions asset for a non-owner, routed through the caption.update gate', function () {
    // Reconciliation-audit finding: a captions retry must be authorized
    // via SpeechPolicy::updateCaptions (the same gate PUT /captions uses),
    // not the controller's own hardcoded owner check — this asserts the
    // real gate is actually wired, not just that ownership happens to
    // agree with it today.
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $failedCaptions = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'failed']);

    $this->actingAs($other)
        ->postJson("/api/speeches/{$speech->id}/assets/{$failedCaptions->id}/retry")
        ->assertForbidden();

    expect($failedCaptions->fresh()->status)->toBe('failed');
});

it('retrying a failed video asset re-dispatches the transcode job', function () {
    Queue::fake();

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $video = SpeechAsset::factory()->for($speech)->video()->failed()->create();

    $response = $this->actingAs($user)->postJson("/api/speeches/{$speech->id}/assets/{$video->id}/retry");

    $response->assertOk();
    $response->assertJsonPath('asset.status', 'processing');
    expect($video->fresh()->failure_code)->toBeNull();

    Queue::assertPushed(TranscodeSpeechAsset::class, fn ($job) => $job->speechAssetId === $video->id);
});

it('retrying a failed captions asset re-dispatches GenerateCaptions for the owner', function () {
    Queue::fake();

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'failed']);

    $response = $this->actingAs($user)->postJson("/api/speeches/{$speech->id}/assets/{$captions->id}/retry");

    $response->assertOk();
    $response->assertJsonPath('asset.status', 'processing');
    expect($captions->fresh()->failure_code)->toBeNull();

    Queue::assertPushed(GenerateCaptions::class, fn ($job) => $job->captionsAssetId === $captions->id);
});
