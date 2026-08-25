<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-03 acceptance: "Two abandoned uploads do not permanently lock a user
 * out" — media:reconcile must release uploads_in_flight, not just mark the
 * row (§9.1's fourth release path).
 */
it('releases uploads_in_flight for uploads stuck in "uploading" beyond the reconcile window', function () {
    $user = User::factory()->create(['uploads_in_flight' => 2, 'storage_bytes_used' => 80_000_000, 'quota_bytes' => 100_000_000]);
    $speechA = Speech::factory()->for($user)->create();
    $speechB = Speech::factory()->for($user)->create();

    $stale = now()->subHours(3);
    $assetA = SpeechAsset::factory()->for($speechA)->create(['status' => 'uploading', 'client_declared_bytes' => 40_000_000]);
    $assetA->forceFill(['created_at' => $stale])->save();
    $assetB = SpeechAsset::factory()->for($speechB)->create(['status' => 'uploading', 'client_declared_bytes' => 40_000_000]);
    $assetB->forceFill(['created_at' => $stale])->save();

    $this->artisan('media:reconcile')->assertSuccessful();

    $fresh = $user->fresh();
    expect($fresh->uploads_in_flight)->toBe(0);
    expect($fresh->storage_bytes_used)->toBe(0);
    expect($assetA->fresh()->status)->toBe('failed');
    expect($assetA->fresh()->failure_code)->toBe('upload_abandoned');

    // The user can upload again — this is the actual "not locked out" proof:
    // a reservation that would have failed against uploads_in_flight=2 now
    // succeeds.
    expect(fn () => (new QuotaService)->reserve($fresh, 1000))->not->toThrow(Throwable::class);
});

it('does not touch uploads still within the reconcile window', function () {
    $user = User::factory()->create(['uploads_in_flight' => 1]);
    $speech = Speech::factory()->for($user)->create();
    $asset = SpeechAsset::factory()->for($speech)->create(['status' => 'uploading']);

    $this->artisan('media:reconcile')->assertSuccessful();

    expect($asset->fresh()->status)->toBe('uploading');
    expect($user->fresh()->uploads_in_flight)->toBe(1);
});

/**
 * §9.2: "sweeps ... rows stuck in processing beyond two hours" — a hung
 * transcode (crashed worker, lost job) must not leave a speaker staring at
 * "processing" forever with no Retry.
 */
it('marks a hung transcode failed, visibly, without touching quota (already reconciled at upload completion)', function () {
    $user = User::factory()->create(['storage_bytes_used' => 40_000_000, 'uploads_in_flight' => 0]);
    $speech = Speech::factory()->for($user)->create();
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);
    $video->forceFill(['created_at' => now()->subHours(3)])->save();

    $this->artisan('media:reconcile')->assertSuccessful();

    expect($video->fresh()->status)->toBe('failed');
    expect($video->fresh()->failure_code)->toBe('transcode_timed_out');
    expect($user->fresh()->storage_bytes_used)->toBe(40_000_000); // untouched
});

it('does not touch a transcode still within its reconcile window', function () {
    $speech = Speech::factory()->create();
    $video = SpeechAsset::factory()->for($speech)->video()->create(['status' => 'processing']);

    $this->artisan('media:reconcile')->assertSuccessful();

    expect($video->fresh()->status)->toBe('processing');
});

/**
 * Code-review finding: the voice-note reconcile branches resolved
 * "$asset->voiceAnnotation?->review?->reviewer" from the top-of-loop
 * batch-fetch snapshot instead of the row locked moments later inside each
 * transaction — a stale reviewer that silently skips releasing/reconciling
 * the reserved quota (matches the reviewer-resolution races fixed the same
 * way in NormalizeVoiceNote/FfmpegVoiceNoteProcessor). This test proves the
 * fixed code path's normal-case arithmetic; the race itself needs real
 * concurrent deletion mid-transaction to reproduce, which a synchronous
 * test cannot force — reverting the fix does not fail this test.
 */
it('releases quota for a hung voice-note normalization, resolving the reviewer under the lock', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);
    $reviewer = User::factory()->create(['storage_bytes_used' => 5_000_000, 'quota_bytes' => 100_000_000]);
    $reviewer->assignRole('coach');
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $reviewer->id, 'status' => 'in_progress']);

    $asset = SpeechAsset::factory()->for($speech)->voiceNote()->create([
        'status' => 'processing',
        'temporary_path' => 'voice-notes/tmp/stale.m4a',
        'temporary_byte_size' => 2_000_000,
    ]);
    Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'pending']);
    $asset->forceFill(['updated_at' => now()->subHours(3)])->save();

    $this->artisan('media:reconcile')->assertSuccessful();

    expect($asset->fresh()->status)->toBe('failed');
    expect($asset->fresh()->failure_code)->toBe('voice_normalization_failed');
    expect($reviewer->fresh()->storage_bytes_used)->toBe(3_000_000);
});

it('reconciles quota for a ready voice note whose temporary reservation was never cleared, resolving the reviewer under the lock', function () {
    Storage::fake('media');
    $this->seed(RoleSeeder::class);
    $reviewer = User::factory()->create(['storage_bytes_used' => 5_000_000, 'quota_bytes' => 100_000_000]);
    $reviewer->assignRole('coach');
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $reviewer->id, 'status' => 'in_progress']);

    $asset = SpeechAsset::factory()->for($speech)->voiceNote()->create([
        'status' => 'ready',
        'byte_size' => 1_500_000,
        'temporary_path' => 'voice-notes/tmp/leftover.m4a',
        'temporary_byte_size' => 2_000_000,
    ]);
    Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'ready']);
    $asset->forceFill(['updated_at' => now()->subHours(3)])->save();

    $this->artisan('media:reconcile')->assertSuccessful();

    expect($asset->fresh()->temporary_path)->toBeNull();
    expect($asset->fresh()->temporary_byte_size)->toBeNull();
    // reconcileDirect(reserved=2_000_000, real=1_500_000): delta -500_000.
    expect($reviewer->fresh()->storage_bytes_used)->toBe(4_500_000);
});
