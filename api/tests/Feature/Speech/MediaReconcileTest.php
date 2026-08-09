<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;

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
