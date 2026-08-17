<?php

use App\Jobs\GenerateCaptions;
use App\Jobs\TranscodeSpeechAsset;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\MultipartUploadService;
use Illuminate\Support\Facades\Queue;

/**
 * §9.1's four endpoints, exercised end to end against a mocked
 * MultipartUploadService (real S3/SeaweedFS isn't reachable from this test
 * environment — this mirrors MediaUrlSignerTest's house style of mocking
 * at the storage boundary, one level up).
 */
it('reserves quota and opens a multipart upload on create', function () {
    $user = User::factory()->create(['quota_bytes' => 1_000_000_000]);
    $speech = Speech::factory()->for($user)->create();

    $this->mock(MultipartUploadService::class, function ($mock) {
        $mock->shouldReceive('create')->once()->andReturn('fake-upload-id');
    });

    $response = $this->actingAs($user)->postJson("/api/speeches/{$speech->id}/assets/uploads", [
        'original_filename' => 'my-speech.mp4',
        'content_type' => 'video/mp4',
        'byte_size' => 40_000_000,
    ]);

    $response->assertCreated();
    $response->assertJsonPath('upload_id', 'fake-upload-id');
    expect($user->fresh()->storage_bytes_used)->toBe(40_000_000);
    expect($user->fresh()->uploads_in_flight)->toBe(1);

    $asset = SpeechAsset::query()->where('speech_id', $speech->id)->sole();
    expect($asset->kind)->toBe('source');
    expect($asset->status)->toBe('uploading');
    expect($asset->path)->toStartWith("uploads/{$user->id}/");
});

it('rejects create when it would exceed the quota, and opens no multipart upload', function () {
    $user = User::factory()->create(['quota_bytes' => 100]);
    $speech = Speech::factory()->for($user)->create();

    $this->mock(MultipartUploadService::class, function ($mock) {
        $mock->shouldReceive('create')->never();
    });

    $response = $this->actingAs($user)->postJson("/api/speeches/{$speech->id}/assets/uploads", [
        'original_filename' => 'my-speech.mp4',
        'content_type' => 'video/mp4',
        'byte_size' => 1000,
    ]);

    $response->assertUnprocessable();
    expect(SpeechAsset::query()->where('speech_id', $speech->id)->count())->toBe(0);
});

it('completes an upload: reconciles the real byte_size, marks the source ready, and dispatches a transcode job for a new processing video asset', function () {
    Queue::fake();

    $user = User::factory()->create(['quota_bytes' => 1_000_000_000]);
    $speech = Speech::factory()->for($user)->create();
    $asset = SpeechAsset::factory()->for($speech)->create([
        'status' => 'uploading',
        'upload_id' => 'fake-upload-id',
        'client_declared_bytes' => 1, // the untrusted, understated declaration
    ]);

    $this->mock(MultipartUploadService::class, function ($mock) {
        $mock->shouldReceive('complete')->once()->andReturn(['byte_size' => 40_000_000]);
    });

    $response = $this->actingAs($user)->postJson(
        "/api/speeches/{$speech->id}/assets/{$asset->id}/uploads/fake-upload-id/complete",
        ['parts' => [['part_number' => 1, 'etag' => '"abc123"']]],
    );

    $response->assertOk();
    $response->assertJsonPath('asset.status', 'processing');

    expect($asset->fresh()->status)->toBe('ready');
    expect($asset->fresh()->byte_size)->toBe(40_000_000);

    $video = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'video')->sole();
    expect($video->status)->toBe('processing');
    expect($video->is_primary)->toBeTrue();

    Queue::assertPushed(TranscodeSpeechAsset::class, fn ($job) => $job->speechAssetId === $video->id);
});

/**
 * STEP-09-captions.md (R11): dispatched from the SAME transaction as
 * TranscodeSpeechAsset, on a genuinely different queue/connection literal
 * — this is what actually delivers "a two-second remux still completes in
 * seconds instead of waiting behind a five-minute transcription".
 */
it('also dispatches GenerateCaptions on a separate queue when captions are enabled', function () {
    Queue::fake();

    $user = User::factory()->create(['quota_bytes' => 1_000_000_000]);
    $speech = Speech::factory()->for($user)->create(['captions_enabled' => true]);
    $asset = SpeechAsset::factory()->for($speech)->create([
        'status' => 'uploading',
        'upload_id' => 'fake-upload-id',
        'client_declared_bytes' => 1,
    ]);

    $this->mock(MultipartUploadService::class, function ($mock) {
        $mock->shouldReceive('complete')->once()->andReturn(['byte_size' => 40_000_000]);
    });

    $this->actingAs($user)->postJson(
        "/api/speeches/{$speech->id}/assets/{$asset->id}/uploads/fake-upload-id/complete",
        ['parts' => [['part_number' => 1, 'etag' => '"abc123"']]],
    )->assertOk();

    $captions = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->sole();
    expect($captions->status)->toBe('processing');
    expect($captions->format)->toBe('vtt');

    Queue::assertPushed(GenerateCaptions::class, function ($job) use ($captions) {
        return $job->captionsAssetId === $captions->id
            && $job->connection === 'redis-long'
            && $job->queue === 'captions';
    });

    // TranscodeSpeechAsset is pushed too, but onto a DIFFERENT queue name
    // on the same connection — the R11 guarantee this test exists for.
    Queue::assertPushed(TranscodeSpeechAsset::class, fn ($job) => $job->connection === 'redis-long' && $job->queue === 'transcode');
});

it('does not create a captions asset or dispatch GenerateCaptions when captions_enabled is false', function () {
    Queue::fake();

    $user = User::factory()->create(['quota_bytes' => 1_000_000_000]);
    $speech = Speech::factory()->for($user)->create(['captions_enabled' => false]);
    $asset = SpeechAsset::factory()->for($speech)->create([
        'status' => 'uploading',
        'upload_id' => 'fake-upload-id',
        'client_declared_bytes' => 1,
    ]);

    $this->mock(MultipartUploadService::class, function ($mock) {
        $mock->shouldReceive('complete')->once()->andReturn(['byte_size' => 40_000_000]);
    });

    $this->actingAs($user)->postJson(
        "/api/speeches/{$speech->id}/assets/{$asset->id}/uploads/fake-upload-id/complete",
        ['parts' => [['part_number' => 1, 'etag' => '"abc123"']]],
    )->assertOk();

    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->exists())->toBeFalse();
    Queue::assertNotPushed(GenerateCaptions::class);
});

it('aborting an upload releases both quota counters and deletes the asset', function () {
    $user = User::factory()->create(['storage_bytes_used' => 5_000_000, 'uploads_in_flight' => 1, 'quota_bytes' => 1_000_000_000]);
    $speech = Speech::factory()->for($user)->create();
    $asset = SpeechAsset::factory()->for($speech)->create([
        'status' => 'uploading',
        'upload_id' => 'fake-upload-id',
        'client_declared_bytes' => 5_000_000,
    ]);

    $this->mock(MultipartUploadService::class, function ($mock) {
        $mock->shouldReceive('abort')->once();
    });

    $response = $this->actingAs($user)->deleteJson(
        "/api/speeches/{$speech->id}/assets/{$asset->id}/uploads/fake-upload-id",
    );

    $response->assertNoContent();
    expect($user->fresh()->storage_bytes_used)->toBe(0);
    expect($user->fresh()->uploads_in_flight)->toBe(0);
    expect(SpeechAsset::query()->find($asset->id))->toBeNull();
});

it('a second Member cannot create, complete, or abort an upload on someone else\'s speech', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $asset = SpeechAsset::factory()->for($speech)->create(['upload_id' => 'x']);

    $this->actingAs($other)->postJson("/api/speeches/{$speech->id}/assets/uploads", [
        'original_filename' => 'a.mp4', 'content_type' => 'video/mp4', 'byte_size' => 100,
    ])->assertNotFound();

    $this->actingAs($other)->postJson("/api/speeches/{$speech->id}/assets/{$asset->id}/uploads/x/complete", [
        'parts' => [['part_number' => 1, 'etag' => 'x']],
    ])->assertNotFound();

    $this->actingAs($other)->deleteJson("/api/speeches/{$speech->id}/assets/{$asset->id}/uploads/x")
        ->assertNotFound();
});
