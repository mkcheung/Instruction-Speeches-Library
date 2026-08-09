<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use Illuminate\Validation\ValidationException;

/**
 * §9.1: the conditional UPDATE and all four release paths.
 */
it('reserves quota atomically and rejects a reservation that would exceed it', function () {
    $user = User::factory()->create(['storage_bytes_used' => 0, 'quota_bytes' => 100, 'uploads_in_flight' => 0]);
    $service = new QuotaService;

    $service->reserve($user, 60);
    expect($user->fresh()->storage_bytes_used)->toBe(60);
    expect($user->fresh()->uploads_in_flight)->toBe(1);

    expect(fn () => $service->reserve($user->fresh(), 41))
        ->toThrow(ValidationException::class);

    // Rejected reservation must not have partially applied.
    expect($user->fresh()->storage_bytes_used)->toBe(60);
});

it('caps concurrent uploads per user at two, in the same statement as the byte check', function () {
    $user = User::factory()->create(['storage_bytes_used' => 0, 'quota_bytes' => 1_000_000, 'uploads_in_flight' => 2]);
    $service = new QuotaService;

    expect(fn () => $service->reserve($user, 1))->toThrow(ValidationException::class);
});

it('reconciles storage_bytes_used by the delta between the declared and real byte_size on completion', function () {
    // The acceptance item: "a client declaring a 1-byte size for a 40 MB
    // file does not evade the quota."
    $user = User::factory()->create(['storage_bytes_used' => 1, 'quota_bytes' => 1_000_000_000, 'uploads_in_flight' => 1]);
    $speech = Speech::factory()->for($user)->create();
    $asset = SpeechAsset::factory()->for($speech)->create(['client_declared_bytes' => 1]);

    (new QuotaService)->releaseOnComplete($asset, 40_000_000);

    $fresh = $user->fresh();
    expect($fresh->storage_bytes_used)->toBe(40_000_000);
    expect($fresh->uploads_in_flight)->toBe(0);
});

it('releases both counters on abort without going negative', function () {
    $user = User::factory()->create(['storage_bytes_used' => 10, 'quota_bytes' => 1000, 'uploads_in_flight' => 1]);
    $speech = Speech::factory()->for($user)->create();
    $asset = SpeechAsset::factory()->for($speech)->create(['client_declared_bytes' => 500]);

    (new QuotaService)->releaseOnAbort($asset);

    $fresh = $user->fresh();
    expect($fresh->storage_bytes_used)->toBe(0); // clamped, not -490
    expect($fresh->uploads_in_flight)->toBe(0);
});
