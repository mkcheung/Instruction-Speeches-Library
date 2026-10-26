<?php

use App\Models\Connection;
use App\Models\User;
use App\Services\ConnectionService;
use App\Services\FriendDirectoryService;
use App\Support\ConnectionPair;
use Symfony\Component\HttpKernel\Exception\HttpException;

it('keeps service structural validity directory projections and reconciliation in context', function (array $case, bool $viewerIsLower) {
    $people = [User::factory()->create(['first_name' => 'Matrix', 'username' => 'matrix-a-'.uniqid()]),
        User::factory()->create(['first_name' => 'Matrix', 'username' => 'matrix-b-'.uniqid()])];
    [$viewer, $peer] = $viewerIsLower ? $people : array_reverse($people);
    $state = $case['state'];
    $mine = $mirror = null;
    if ($state !== null) {
        $initiator = array_key_exists('initiator', $case) ? $case['initiator'] : (($case['outgoing'] ?? false) ? $viewer->id : $peer->id);
        $values = ['state' => $state, 'initiated_by_id' => $initiator,
            'blocked_by_id' => $state === 'blocked' || ($case['stale_blocker'] ?? false) ? $peer->id : null,
            'requested_at' => ($case['missing_time'] ?? false) ? null : '2026-01-02 03:04:05',
            'connected_at' => $state === 'accepted' && ! ($case['missing_time'] ?? false) ? '2026-01-03 03:04:05' : null];
        $mine = Connection::factory()->create($values + ['owner_id' => $viewer->id, 'peer_id' => $peer->id]);
        if (! ($case['missing_mirror'] ?? false)) {
            $mirror = Connection::factory()->create(array_replace($values, ['owner_id' => $peer->id, 'peer_id' => $viewer->id, 'state' => $case['mirror_state'] ?? $state],
                ($case['conflicting_initiator'] ?? false) ? ['initiated_by_id' => $viewer->id] : [],
                ($case['conflicting_blocker'] ?? false) ? ['blocked_by_id' => $viewer->id] : []));
        }
    }
    $directory = app(FriendDirectoryService::class);
    expect(ConnectionPair::isValid($mine, $mirror))->toBe($case['valid']);
    $relationship = $directory->relationship($viewer, $peer);
    expect($relationship['state'])->toBe($case['relationship']);
    expect($relationship['connection_id'])->toBe(in_array($case['relationship'], ['accepted', 'pending'], true) ? $mine?->id : null);
    expect($relationship['direction'])->toBe($case['relationship'] === 'pending' ? (($case['outgoing'] ?? false) ? 'outgoing' : 'incoming') : null);
    expect($directory->friends($viewer, 'accepted', '', null)['rows'])->toHaveCount($case['accepted']);
    expect($directory->friends($viewer, 'incoming', '', null)['rows'])->toHaveCount($case['incoming']);
    expect($directory->find($viewer, 'Matrix', null)['rows'])->toHaveCount($case['find']);

    // Corruption must fail at the service boundary before any transition masks it.
    if ($mine !== null && ! $case['valid']) {
        try {
            app(ConnectionService::class)->decline($viewer, $mine->id);
            test()->fail('Invalid pair was accepted by the mutation service.');
        } catch (HttpException $error) {
            expect($error->getStatusCode())->toBe(409);
            expect($error->getMessage())->toBe('This connection is unavailable.');
        }
    }
    $before = Connection::query()->orderBy('id')->get()->map->getAttributes()->all();
    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();
    if (in_array($case['repair'], ['unchanged', 'unresolved'], true)) {
        expect(Connection::query()->orderBy('id')->get()->map->getAttributes()->all())->toBe($before);
    } else {
        $after = Connection::query()->orderBy('owner_id')->get();
        expect($after)->toHaveCount(2);
        expect(ConnectionPair::isValid($after[0], $after[1]))->toBeTrue();
    }
    $once = Connection::query()->orderBy('id')->get()->map->getAttributes()->all();
    $this->artisan('connections:reconcile-asymmetry')->assertSuccessful();
    expect(Connection::query()->orderBy('id')->get()->map->getAttributes()->all())->toBe($once);
})->with('connection pair shapes')->with([true, false]);
