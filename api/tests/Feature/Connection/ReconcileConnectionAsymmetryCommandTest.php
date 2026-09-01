<?php

use App\Models\Connection;
use App\Models\User;

/**
 * STEP-13-FROZEN-CONTRACT.md §7. Deliberately writes rows directly via the
 * factory (bypassing ConnectionService) to construct the exact asymmetric
 * states the reconciler exists to repair — going through the service
 * couldn't produce these in the first place.
 */
it('resolves a state mismatch between mirrored rows, blocked taking precedence', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    [$low, $high] = $a->id < $b->id ? [$a, $b] : [$b, $a];

    Connection::factory()->create(['owner_id' => $low->id, 'peer_id' => $high->id, 'state' => 'blocked', 'blocked_by_id' => $low->id]);
    Connection::factory()->create(['owner_id' => $high->id, 'peer_id' => $low->id, 'state' => 'accepted']);

    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();

    expect(Connection::query()->where('owner_id', $low->id)->first()->state)->toBe('blocked');
    expect(Connection::query()->where('owner_id', $high->id)->first()->state)->toBe('blocked');
});

it('creates a missing mirror row', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    [$low, $high] = $a->id < $b->id ? [$a, $b] : [$b, $a];

    Connection::factory()->create(['owner_id' => $low->id, 'peer_id' => $high->id, 'state' => 'accepted']);

    expect(Connection::query()->count())->toBe(1);

    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();

    expect(Connection::query()->count())->toBe(2);
    expect(Connection::query()->where('owner_id', $high->id)->where('peer_id', $low->id)->first()->state)->toBe('accepted');
});

it('creates a missing mirror row when the surviving row is the higher-owner-id side', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    [$low, $high] = $a->id < $b->id ? [$a, $b] : [$b, $a];

    Connection::factory()->create(['owner_id' => $high->id, 'peer_id' => $low->id, 'state' => 'accepted']);

    expect(Connection::query()->count())->toBe(1);

    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();

    expect(Connection::query()->count())->toBe(2);
    expect(Connection::query()->where('owner_id', $low->id)->where('peer_id', $high->id)->first()->state)->toBe('accepted');
});

it('leaves agreeing pairs untouched', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    [$low, $high] = $a->id < $b->id ? [$a, $b] : [$b, $a];

    Connection::factory()->create(['owner_id' => $low->id, 'peer_id' => $high->id, 'state' => 'pending']);
    Connection::factory()->create(['owner_id' => $high->id, 'peer_id' => $low->id, 'state' => 'pending']);

    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();

    expect(Connection::query()->count())->toBe(2);
    expect(Connection::query()->where('owner_id', $low->id)->first()->state)->toBe('pending');
});
