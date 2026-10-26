<?php

use App\Models\Connection;
use App\Support\ConnectionPair;

it('validates both model and query row representations without changing projection rules', function (array $case) {
    $state = $case['state'];
    $first = $second = null;
    if ($state !== null) {
        $initiator = array_key_exists('initiator', $case) ? $case['initiator'] : (($case['outgoing'] ?? false) ? 2 : 7);
        $attributes = ['owner_id' => 2, 'peer_id' => 7, 'state' => $state, 'initiated_by_id' => $initiator,
            'blocked_by_id' => $state === 'blocked' || ($case['stale_blocker'] ?? false) ? 7 : null];
        $first = new Connection($attributes);
        if (! ($case['missing_mirror'] ?? false)) {
            $second = new Connection(array_replace($attributes, ['owner_id' => 7, 'peer_id' => 2, 'state' => $case['mirror_state'] ?? $state],
                ($case['conflicting_initiator'] ?? false) ? ['initiated_by_id' => 2] : [],
                ($case['conflicting_blocker'] ?? false) ? ['blocked_by_id' => 2] : []));
        }
    }
    expect(ConnectionPair::isValid($first, $second))->toBe($case['valid']);
    expect(ConnectionPair::isValid($first ? (object) $first->getAttributes() : null, $second ? (object) $second->getAttributes() : null))->toBe($case['valid']);
})->with('connection pair shapes');

it('accepts canonical bigint strings but rejects malformed or foreign participant ids', function (mixed $value, bool $valid) {
    $first = (object) ['owner_id' => '2', 'peer_id' => '7', 'state' => 'accepted', 'initiated_by_id' => $value, 'blocked_by_id' => null];
    $second = (object) ['owner_id' => '7', 'peer_id' => '2', 'state' => 'accepted', 'initiated_by_id' => $value, 'blocked_by_id' => null];
    expect(ConnectionPair::isValid($first, $second))->toBe($valid);
})->with([['7', true], [7, true], [null, false], [0, false], ['07', false], ['7x', false], [7.0, false], [true, false], [8, false], ['999999999999999999999999999999', false]]);

it('rejects self edges missing reversed participants unknown states and blocked pairs without a blocker', function (array $change) {
    $first = (object) array_replace(['owner_id' => 2, 'peer_id' => 7, 'state' => 'accepted', 'initiated_by_id' => 7, 'blocked_by_id' => null], $change);
    $second = (object) ['owner_id' => 7, 'peer_id' => 2, 'state' => $first->state, 'initiated_by_id' => 7, 'blocked_by_id' => null];
    expect(ConnectionPair::isValid($first, $second))->toBeFalse();
})->with([[['owner_id' => 7]], [['peer_id' => 8]], [['state' => 'unknown']], [['state' => 'blocked']]]);
