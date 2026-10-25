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

it('aligns the initiator and blocker on a pair whose rows agree on state but not on attributes', function () {
    // Eligible people (named, with usernames) so the HTTP unblock below is not refused as unavailable.
    $a = User::factory()->create(['first_name' => 'Align', 'last_name' => 'One', 'username' => 'align-one-'.uniqid()]);
    $b = User::factory()->create(['first_name' => 'Align', 'last_name' => 'Two', 'username' => 'align-two-'.uniqid()]);
    [$low, $high] = $a->id < $b->id ? [$a, $b] : [$b, $a];

    // What an old block() left when it filled a missing mirror with a NULL initiator.
    Connection::factory()->create(['owner_id' => $low->id, 'peer_id' => $high->id, 'state' => 'blocked', 'initiated_by_id' => $low->id, 'blocked_by_id' => $high->id]);
    Connection::factory()->create(['owner_id' => $high->id, 'peer_id' => $low->id, 'state' => 'blocked', 'initiated_by_id' => null, 'blocked_by_id' => $high->id]);

    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();

    $rows = Connection::query()->orderBy('owner_id')->get();
    expect($rows->pluck('initiated_by_id')->unique()->all())->toBe([$low->id]);
    expect($rows->pluck('blocked_by_id')->unique()->all())->toBe([$high->id]);

    // And the repaired pair is usable again: the blocker can lift the block.
    $this->actingAs($high)->postJson('/api/connections/'.$rows->firstWhere('owner_id', $high->id)->id.'/unblock')->assertOk();
});
