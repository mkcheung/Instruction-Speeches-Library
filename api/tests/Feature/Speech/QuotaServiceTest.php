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

/**
 * §7.8: the conflated "quota, or you already have 2 uploads" message is
 * split by actual cause. These two tests pin that a quota failure and a
 * concurrency failure produce different, cause-specific text — not just
 * that reserve() throws.
 */
it('names the quota as the cause when storage would be exceeded with room for another upload', function () {
    $user = User::factory()->create(['storage_bytes_used' => 90, 'quota_bytes' => 100, 'uploads_in_flight' => 0]);
    $service = new QuotaService;

    try {
        $service->reserve($user, 20);
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        expect($e->errors()['file'][0])->toBe('This upload would exceed your storage quota.');
    }
});

it('names the concurrency cap as the cause when quota has room but 2 uploads are already in flight', function () {
    $user = User::factory()->create(['storage_bytes_used' => 0, 'quota_bytes' => 1_000_000, 'uploads_in_flight' => 2]);
    $service = new QuotaService;

    try {
        $service->reserve($user, 1);
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        expect($e->errors()['file'][0])->toBe('You already have 2 uploads in progress. Wait for one to finish before starting another.');
    }
});

/**
 * code-review finding: the two causes are not mutually exclusive — a user
 * can be over quota AND at the concurrency cap simultaneously. The first
 * version of this split only ever named whichever was checked first
 * (quota), so a user in this state who freed up space would retry and be
 * rejected again with no indication the concurrency cap was the OTHER
 * reason.
 */
it('names both causes when the user is over quota and at the concurrency cap at the same time', function () {
    $user = User::factory()->create(['storage_bytes_used' => 99, 'quota_bytes' => 100, 'uploads_in_flight' => 2]);
    $service = new QuotaService;

    try {
        $service->reserve($user, 5);
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        $message = $e->errors()['file'][0];
        expect($message)->toContain('exceed your storage quota');
        expect($message)->toContain('2 uploads in progress');
    }
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
