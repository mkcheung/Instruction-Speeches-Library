<?php

use App\Jobs\GeneratePoster;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Illuminate\Support\Facades\Queue;

/**
 * STEP-04-every-video-plays.md §9.5's single frame-picking endpoint
 * (SpeechUploadController::setPosterFrame): serves both "use current frame"
 * and the sprite-picker with one call. Depends on App\Jobs\GeneratePoster,
 * which is another agent's slice (Services/Transcoding + Jobs) — if that
 * class doesn't exist yet when this runs, the dispatch-path test below will
 * fail with a class-not-found error, not a bug in this file.
 */
it('updates poster_time_seconds and dispatches GeneratePoster with the chosen time', function () {
    Queue::fake();

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $video = SpeechAsset::factory()->for($speech)->video()->ready()->create();

    $response = $this->actingAs($user)
        ->postJson("/api/speeches/{$speech->id}/assets/{$video->id}/poster-frame", ['time_seconds' => 12.5]);

    $response->assertOk();
    $response->assertJsonPath('asset.id', $video->id);
    expect((float) $video->fresh()->poster_time_seconds)->toBe(12.5);

    Queue::assertPushed(GeneratePoster::class, fn ($job) => $job->videoAssetId === $video->id
        && $job->explicitTimeSeconds === 12.5);
});

it('accepts a null time_seconds ("let the transcoder pick automatically")', function () {
    Queue::fake();

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $video = SpeechAsset::factory()->for($speech)->video()->ready()->create();

    $response = $this->actingAs($user)
        ->postJson("/api/speeches/{$speech->id}/assets/{$video->id}/poster-frame", ['time_seconds' => null]);

    $response->assertOk();
    expect($video->fresh()->poster_time_seconds)->toBeNull();

    Queue::assertPushed(GeneratePoster::class, fn ($job) => $job->videoAssetId === $video->id
        && $job->explicitTimeSeconds === null);
});

it('rejects a negative time_seconds', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $video = SpeechAsset::factory()->for($speech)->video()->ready()->create();

    $response = $this->actingAs($user)
        ->postJson("/api/speeches/{$speech->id}/assets/{$video->id}/poster-frame", ['time_seconds' => -1]);

    $response->assertStatus(422);
});

it('refuses a non-owner', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $video = SpeechAsset::factory()->for($speech)->video()->ready()->create();

    $this->actingAs($other)
        ->postJson("/api/speeches/{$speech->id}/assets/{$video->id}/poster-frame", ['time_seconds' => 1])
        ->assertNotFound();
});

it('refuses an asset that is not a ready video (wrong kind or not ready)', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $processingVideo = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);
    $sourceAsset = SpeechAsset::factory()->for($speech)->create(['status' => 'ready']);

    $this->actingAs($user)
        ->postJson("/api/speeches/{$speech->id}/assets/{$processingVideo->id}/poster-frame", ['time_seconds' => 1])
        ->assertNotFound();

    $this->actingAs($user)
        ->postJson("/api/speeches/{$speech->id}/assets/{$sourceAsset->id}/poster-frame", ['time_seconds' => 1])
        ->assertNotFound();
});
