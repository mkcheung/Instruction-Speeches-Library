<?php

use App\Exceptions\ConnectionBlockedException;
use App\Exceptions\SelfConnectionNotPermittedException;
use App\Models\Connection;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Services\ConnectionService;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * STEP-13-FROZEN-CONTRACT.md §5 — the `ConnectionService` state machine.
 * Mirrors ReviewServiceTest's shape (basic smoke coverage plus the
 * simulated-concurrency idempotency pattern that file already establishes
 * as this codebase's idiom for "concurrency test" on a sqlite-driven suite).
 */
it('throws SelfConnectionNotPermittedException when a user requests themselves', function () {
    $user = User::factory()->create();

    expect(fn () => app(ConnectionService::class)->request($user, $user, null))
        ->toThrow(SelfConnectionNotPermittedException::class);
});

it('creates a mirrored pending pair on request', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();

    $mine = app(ConnectionService::class)->request($a, $b, 'hello');

    expect($mine->state)->toBe('pending');
    expect($mine->initiated_by_id)->toBe($a->id);
    expect(Connection::query()->count())->toBe(2);

    $theirs = Connection::query()->where('owner_id', $b->id)->where('peer_id', $a->id)->firstOrFail();
    expect($theirs->state)->toBe('pending');
    expect($theirs->initiated_by_id)->toBe($a->id);
    expect($theirs->note)->toBe('hello');
});

it('resolves a crossed request to accepted on both mirrored rows', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $service = app(ConnectionService::class);

    $service->request($a, $b, null);
    $service->request($b, $a, null);

    expect(Connection::query()->count())->toBe(2);
    Connection::query()->get()->each(function (Connection $row) {
        expect($row->state)->toBe('accepted');
        expect($row->connected_at)->not->toBeNull();
    });
});

it('is idempotent when the same requester re-requests a pending pair', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $service = app(ConnectionService::class);

    $service->request($a, $b, null);
    $service->request($a, $b, null);

    expect(Connection::query()->count())->toBe(2);
    expect(Connection::query()->where('owner_id', $a->id)->first()->state)->toBe('pending');
});

it('reuses the row on declined -> pending re-request', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $service = app(ConnectionService::class);

    $first = $service->request($a, $b, null);
    $service->decline($b, Connection::query()->where('owner_id', $b->id)->where('peer_id', $a->id)->firstOrFail()->id);

    expect(Connection::query()->where('owner_id', $a->id)->first()->state)->toBe('declined');

    $reRequested = $service->request($a, $b, 'again');

    expect($reRequested->id)->toBe($first->id);
    expect($reRequested->state)->toBe('pending');
    expect(Connection::query()->count())->toBe(2);
});

it('accepts a pending inbound request on both mirrored rows', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $service = app(ConnectionService::class);

    $service->request($a, $b, null);
    $bsRow = Connection::query()->where('owner_id', $b->id)->where('peer_id', $a->id)->firstOrFail();

    $accepted = $service->accept($b, $bsRow->id);

    expect($accepted->state)->toBe('accepted');
    expect(Connection::query()->where('owner_id', $a->id)->first()->state)->toBe('accepted');
});

it('declines an accepted connection back to declined on both rows (disconnect)', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $service = app(ConnectionService::class);

    $service->request($a, $b, null);
    $service->request($b, $a, null); // crossed -> accepted

    $aRow = Connection::query()->where('owner_id', $a->id)->firstOrFail();
    $service->decline($a, $aRow->id);

    expect(Connection::query()->where('owner_id', $a->id)->first()->state)->toBe('declined');
    expect(Connection::query()->where('owner_id', $b->id)->first()->state)->toBe('declined');
});

it('blocks without touching an existing review row', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $speech = Speech::factory()->for($b)->create();
    $review = Review::factory()->for($speech)->create([
        'reviewer_id' => $a->id,
        'speech_owner_id' => $b->id,
        'status' => 'published',
    ]);

    app(ConnectionService::class)->block($a, $b);

    expect(Connection::query()->where('owner_id', $a->id)->first()->state)->toBe('blocked');
    expect(Connection::query()->where('owner_id', $b->id)->first()->state)->toBe('blocked');
    expect($review->fresh()->status)->toBe('published');
    expect($review->fresh()->revoked_at)->toBeNull();
});

it('a blocked request cannot be re-requested around the block', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $service = app(ConnectionService::class);

    $service->block($a, $b);

    expect(fn () => $service->request($b, $a, null))->toThrow(ConnectionBlockedException::class);
});

it('unblock always lands on declined, never accepted', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $service = app(ConnectionService::class);

    $service->block($a, $b);
    $unblocked = $service->unblock($a, $b);

    expect($unblocked->state)->toBe('declined');
    expect(Connection::query()->where('owner_id', $b->id)->first()->state)->toBe('declined');
});

it('only the blocker may unblock', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $service = app(ConnectionService::class);

    $service->block($a, $b);

    expect(fn () => $service->unblock($b, $a))->toThrow(HttpException::class);
});
