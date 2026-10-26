<?php

use App\Models\Connection;
use App\Models\User;
use App\Services\ConnectionService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;

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
    Connection::factory()->create(['owner_id' => $high->id, 'peer_id' => $low->id, 'state' => 'accepted', 'initiated_by_id' => $low->id]);

    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();

    expect(Connection::query()->where('owner_id', $low->id)->first()->state)->toBe('blocked');
    expect(Connection::query()->where('owner_id', $high->id)->first()->state)->toBe('blocked');
});

it('creates a missing mirror row', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    [$low, $high] = $a->id < $b->id ? [$a, $b] : [$b, $a];

    Connection::factory()->create(['owner_id' => $low->id, 'peer_id' => $high->id, 'state' => 'accepted', 'initiated_by_id' => $low->id]);

    expect(Connection::query()->count())->toBe(1);

    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();

    expect(Connection::query()->count())->toBe(2);
    expect(Connection::query()->where('owner_id', $high->id)->where('peer_id', $low->id)->first()->state)->toBe('accepted');
});

it('creates a missing mirror row when the surviving row is the higher-owner-id side', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    [$low, $high] = $a->id < $b->id ? [$a, $b] : [$b, $a];

    Connection::factory()->create(['owner_id' => $high->id, 'peer_id' => $low->id, 'state' => 'accepted', 'initiated_by_id' => $low->id]);

    expect(Connection::query()->count())->toBe(1);

    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();

    expect(Connection::query()->count())->toBe(2);
    expect(Connection::query()->where('owner_id', $low->id)->where('peer_id', $high->id)->first()->state)->toBe('accepted');
});

it('leaves agreeing pairs untouched', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    [$low, $high] = $a->id < $b->id ? [$a, $b] : [$b, $a];

    Connection::factory()->create(['owner_id' => $low->id, 'peer_id' => $high->id, 'state' => 'pending', 'initiated_by_id' => $low->id]);
    Connection::factory()->create(['owner_id' => $high->id, 'peer_id' => $low->id, 'state' => 'pending', 'initiated_by_id' => $low->id]);

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

it('clears stale blockers in every nonblocked state including matching stale attributes', function (string $state, bool $matching) {
    $a = User::factory()->create(['first_name' => 'Repair', 'username' => 'repair-a-'.uniqid()]);
    $b = User::factory()->create(['first_name' => 'Repair', 'username' => 'repair-b-'.uniqid()]);
    $values = ['state' => $state, 'initiated_by_id' => $a->id, 'blocked_by_id' => $a->id];
    $mine = Connection::factory()->create($values + ['owner_id' => $a->id, 'peer_id' => $b->id]);
    Connection::factory()->create(array_replace($values, ['owner_id' => $b->id, 'peer_id' => $a->id, 'blocked_by_id' => $matching ? $a->id : null]));

    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();

    expect(Connection::query()->pluck('blocked_by_id')->all())->toBe([null, null]);
    expect(app(ConnectionService::class)->decline($a, $mine->id)->state)->toBe('declined');
})->with(['accepted', 'pending', 'declined'])->with([false, true]);

it('reports conflicting block ownership without granting either party new authority', function () {
    $a = User::factory()->create(['first_name' => 'Blocked', 'username' => 'blocked-a-'.uniqid()]);
    $b = User::factory()->create(['first_name' => 'Blocked', 'username' => 'blocked-b-'.uniqid()]);
    foreach ([[$a, $b], [$b, $a]] as [$owner, $peer]) {
        Connection::factory()->create(['owner_id' => $owner->id, 'peer_id' => $peer->id, 'state' => 'blocked', 'blocked_by_id' => $owner->id]);
    }
    $before = Connection::query()->get()->map->getAttributes()->all();
    Log::spy();

    $this->artisan('connections:reconcile-asymmetry')->expectsOutputToContain('1 unresolved pair(s)')->assertSuccessful();

    expect(Connection::query()->get()->map->getAttributes()->all())->toBe($before);
    Log::shouldHaveReceived('warning')->once()->with('Connection reconciliation requires attention.',
        ['unresolved_pairs' => 1, 'accepted_missing_connected_at_rows' => 0, 'pending_missing_requested_at_rows' => 0]);
    foreach ([[$a, $b], [$b, $a]] as [$owner, $peer]) {
        $row = Connection::where('owner_id', $owner->id)->firstOrFail();
        $this->actingAs($owner)->postJson('/api/connections/'.$row->id.'/unblock')->assertConflict();
    }
});

it('reports invalid agreeing pairs and invalid single survivors without inventing initiators', function (bool $mirror) {
    $a = User::factory()->create();
    $b = User::factory()->create();
    Connection::factory()->create(['owner_id' => $a->id, 'peer_id' => $b->id, 'state' => 'accepted']);
    if ($mirror) {
        Connection::factory()->create(['owner_id' => $b->id, 'peer_id' => $a->id, 'state' => 'accepted']);
    }
    $before = Connection::query()->get()->map->getAttributes()->all();

    $this->artisan('connections:reconcile-asymmetry')->expectsOutputToContain('1 unresolved pair(s)')->assertSuccessful();

    expect(Connection::query()->get()->map->getAttributes()->all())->toBe($before);
})->with([false, true]);

it('does not overwrite ambiguous initiators even when both rows are otherwise repairable', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    foreach ([[$a, $b], [$b, $a]] as [$owner, $peer]) {
        Connection::factory()->create(['owner_id' => $owner->id, 'peer_id' => $peer->id, 'state' => 'pending', 'initiated_by_id' => $owner->id]);
    }
    $before = Connection::query()->get()->map->getAttributes()->all();
    $this->artisan('connections:reconcile-asymmetry')->expectsOutputToContain('1 unresolved pair(s)')->assertSuccessful();
    expect(Connection::query()->get()->map->getAttributes()->all())->toBe($before);
});

it('logs missing historical times once per run without changing valid pairs', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $c = User::factory()->create();
    foreach ([[$a, $b, 'accepted'], [$a, $c, 'pending']] as [$owner, $peer, $state]) {
        foreach ([[$owner, $peer], [$peer, $owner]] as [$x, $y]) {
            Connection::factory()->create(['owner_id' => $x->id, 'peer_id' => $y->id, 'state' => $state, 'initiated_by_id' => $owner->id, 'requested_at' => null, 'connected_at' => null]);
        }
    }
    $before = Connection::query()->get()->map->getAttributes()->all();
    Log::spy();
    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();
    expect(Connection::query()->get()->map->getAttributes()->all())->toBe($before);
    Log::shouldHaveReceived('warning')->once()->with('Connection reconciliation requires attention.',
        ['unresolved_pairs' => 0, 'accepted_missing_connected_at_rows' => 2, 'pending_missing_requested_at_rows' => 2]);
});

it('keeps tied differing states unresolved rather than deriving intent from id order', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    Connection::factory()->create(['owner_id' => $a->id, 'peer_id' => $b->id, 'state' => 'pending', 'initiated_by_id' => $a->id]);
    Connection::factory()->create(['owner_id' => $b->id, 'peer_id' => $a->id, 'state' => 'declined', 'initiated_by_id' => $a->id]);
    $before = Connection::query()->get()->map->getAttributes()->all();

    $this->artisan('connections:reconcile-asymmetry')->expectsOutputToContain('1 unresolved pair(s)')->assertSuccessful();

    expect(Connection::query()->get()->map->getAttributes()->all())->toBe($before);
});

it('rolls back the whole pair when saving its mirror fails', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    foreach ([[$a, $b], [$b, $a]] as [$owner, $peer]) {
        Connection::factory()->create(['owner_id' => $owner->id, 'peer_id' => $peer->id, 'state' => 'declined', 'blocked_by_id' => $a->id]);
    }
    $before = Connection::query()->get()->map->getAttributes()->all();
    $dispatcher = Connection::getEventDispatcher();
    Connection::setEventDispatcher(clone $dispatcher);
    Connection::saving(function (Connection $row) use ($b): void {
        if ($row->owner_id === $b->id) {
            throw new RuntimeException('Mirror save failed.');
        }
    });
    try {
        expect(fn () => Artisan::call('connections:reconcile-asymmetry'))
            ->toThrow(RuntimeException::class, 'Mirror save failed.');
    } finally {
        Connection::setEventDispatcher($dispatcher);
    }
    expect(Connection::query()->get()->map->getAttributes()->all())->toBe($before);
});

it('normalizes stale blockers on missing mirrors and state mismatch repairs', function (bool $mirror) {
    $a = User::factory()->create();
    $b = User::factory()->create();
    Connection::factory()->create(['owner_id' => $a->id, 'peer_id' => $b->id, 'state' => 'accepted', 'initiated_by_id' => $a->id, 'blocked_by_id' => $a->id]);
    if ($mirror) {
        Connection::factory()->create(['owner_id' => $b->id, 'peer_id' => $a->id, 'state' => 'pending', 'initiated_by_id' => $a->id]);
    }
    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();
    expect(Connection::query()->pluck('state')->all())->toBe(['accepted', 'accepted']);
    expect(Connection::query()->pluck('blocked_by_id')->all())->toBe([null, null]);
})->with([false, true]);

it('does not persist an invalid candidate when resolving a state mismatch', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    Connection::factory()->create(['owner_id' => $a->id, 'peer_id' => $b->id, 'state' => 'accepted']);
    Connection::factory()->create(['owner_id' => $b->id, 'peer_id' => $a->id, 'state' => 'pending']);
    $before = Connection::query()->get()->map->getAttributes()->all();
    $this->artisan('connections:reconcile-asymmetry')->expectsOutputToContain('1 unresolved pair(s)')->assertSuccessful();
    expect(Connection::query()->get()->map->getAttributes()->all())->toBe($before);
});
