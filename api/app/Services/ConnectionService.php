<?php

namespace App\Services;

use App\Exceptions\ConnectionBlockedException;
use App\Exceptions\SelfConnectionNotPermittedException;
use App\Models\Connection;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * MODERNIZATION_PLAN §6.7.2 / STEP-13-FROZEN-CONTRACT.md §5 — the
 * `connections` state machine, always written as two mirrored rows.
 *
 * Every public method here takes the two parties as ordinary parameters and
 * internally computes `[$lowId, $highId] = $a->id < $b->id ? [$a, $b] :
 * [$b, $a]` before touching either row — row locks (and the mirrored-pair
 * writes) are always acquired in that fixed order, regardless of which user
 * initiated the action. This mirrors ReviewService's `lockForUpdate()`
 * idiom (see that class), applied to two rows instead of one, and is the
 * whole defence against the AB-BA deadlock: A requests B while B requests A
 * concurrently, and without a fixed lock order the two transactions could
 * take the two rows in opposite orders.
 *
 * `request()` is the one write path that goes further than a lock: two
 * concurrent calls can both be writing the SAME two rows (a genuine crossed
 * request, not just contention on existing rows), which a SELECT-then-write
 * check-and-branch cannot resolve atomically no matter what order the locks
 * are taken in — the two "does a row already exist" reads can both return
 * "no" before either write lands. So `request()` uses a raw
 * `INSERT ... ON CONFLICT (owner_id, peer_id) DO UPDATE` upsert instead
 * (the first use of this pattern in this codebase's application code —
 * every existing upsert uses Eloquent's `updateOrCreate()`, exactly the
 * race this must avoid). The `CASE` expressions inside the `DO UPDATE`
 * encode the whole state machine atomically: a fresh pair inserts pending;
 * a `declined` row is reused (`declined -> pending`, per the unique key);
 * a `pending` row whose `initiated_by_id` differs from this call's caller
 * is a crossed request and resolves straight to `accepted`; a `blocked` or
 * already-`accepted` row is left untouched. Because a `blocked` row can
 * never be moved out of `blocked` by this upsert, the caller doesn't need
 * to pre-check for a block (which would itself just be a stale read) — it
 * writes unconditionally, then reads the row back, and throws
 * ConnectionBlockedException if the result is (still) `blocked`.
 */
class ConnectionService
{
    /**
     * `POST /api/connections` — idempotent-upsert shaped, mirroring
     * `ReviewService::invite`'s own docblock pattern exactly: this one
     * endpoint handles "new request", "re-request after decline", and
     * "crossed request resolves to accepted", all as the same call.
     */
    public function request(User $requester, User $target, ?string $note): Connection
    {
        throw_if($requester->id === $target->id, SelfConnectionNotPermittedException::class, 'You cannot connect with yourself.');

        [$lowId, $highId] = $this->orderedIds($requester, $target);
        $now = now();

        DB::transaction(function () use ($lowId, $highId, $requester, $note, $now) {
            // Lower-owner-id row first, then higher — the fixed lock/write
            // order every method in this class uses.
            $this->upsertRequestRow($lowId, $highId, $requester->id, $note, $now);
            $this->upsertRequestRow($highId, $lowId, $requester->id, $note, $now);
        });

        /** @var Connection $mine */
        $mine = Connection::query()->where('owner_id', $requester->id)->where('peer_id', $target->id)->firstOrFail();

        if ($mine->state === 'blocked') {
            throw new ConnectionBlockedException('This connection cannot be requested.');
        }

        return $mine;
    }

    /**
     * Accept an incoming pending request. `$connectionId` is always the
     * caller's OWN row (`owner_id = $actor->id`) — never a client-supplied
     * cross-party id, matching this codebase's "never accept a
     * client-supplied review_id" rule (ReviewService::findOwnReview) applied
     * to connections.
     */
    public function accept(User $actor, int $connectionId): Connection
    {
        return DB::transaction(function () use ($actor, $connectionId) {
            /** @var Connection $mine */
            $mine = Connection::query()->where('owner_id', $actor->id)->whereKey($connectionId)->lockForUpdate()->firstOrFail();

            [$low, $high] = $this->lockPair($actor->id, $mine->peer_id);

            if ($low->state === 'accepted') {
                return $actor->id === $low->owner_id ? $low : $high;
            }

            if ($low->state !== 'pending' || $low->initiated_by_id === $actor->id) {
                // Not a pending inbound request for this actor (already
                // resolved another way, blocked, or this is the actor's own
                // outgoing request) — nothing to accept.
                abort(409, 'This request cannot be accepted.');
            }

            $now = now();
            foreach ([$low, $high] as $row) {
                $row->state = 'accepted';
                $row->responded_at = $now;
                $row->connected_at = $now;
                $row->save();
            }

            return $actor->id === $low->owner_id ? $low : $high;
        });
    }

    /**
     * Both edges of the state diagram that land on `declined` — rejecting a
     * pending inbound request, and disconnecting an existing `accepted`
     * connection ("either disconnects") — are the same call, matching the
     * plan's diagram exactly (one endpoint, `POST /connections/{id}/decline`,
     * for both).
     */
    public function decline(User $actor, int $connectionId): Connection
    {
        return DB::transaction(function () use ($actor, $connectionId) {
            /** @var Connection $mine */
            $mine = Connection::query()->where('owner_id', $actor->id)->whereKey($connectionId)->lockForUpdate()->firstOrFail();

            [$low, $high] = $this->lockPair($actor->id, $mine->peer_id);

            if ($low->state === 'declined') {
                return $actor->id === $low->owner_id ? $low : $high;
            }

            if ($low->state === 'blocked') {
                abort(409, 'This connection is blocked — unblock before declining.');
            }

            $now = now();
            foreach ([$low, $high] as $row) {
                $row->state = 'declined';
                $row->responded_at = $now;
                $row->save();
            }

            return $actor->id === $low->owner_id ? $low : $high;
        });
    }

    /**
     * Block never touches an existing `reviews` row — blocking is not
     * revoking (STEP-13.md's own acceptance criterion). Unlike
     * `request()`, block/unblock don't need the upsert-race treatment:
     * moving TO `blocked` is idempotent/commutative regardless of the
     * prior state, so a plain lock-then-write is sufficient — there is no
     * "which of two concurrent callers wins" ambiguity to resolve, both
     * outcomes are the same row.
     */
    public function block(User $actor, User $target): Connection
    {
        throw_if($actor->id === $target->id, SelfConnectionNotPermittedException::class, 'You cannot block yourself.');

        return DB::transaction(function () use ($actor, $target) {
            [$low, $high] = $this->lockOrCreatePair($actor->id, $target->id);

            $now = now();
            foreach ([$low, $high] as $row) {
                $row->state = 'blocked';
                $row->blocked_by_id = $actor->id;
                $row->responded_at = $now;
                $row->save();
            }

            return $actor->id === $low->owner_id ? $low : $high;
        });
    }

    /**
     * §6.7.2: unblock always lands on `declined`, never `accepted` —
     * silently restoring a severed relationship is a support ticket. Only
     * the party who placed the block may lift it.
     */
    public function unblock(User $actor, User $target): Connection
    {
        return DB::transaction(function () use ($actor, $target) {
            [$low, $high] = $this->lockPair($actor->id, $target->id);

            if ($low->state !== 'blocked') {
                abort(409, 'This connection is not blocked.');
            }

            if ($low->blocked_by_id !== $actor->id) {
                abort(403, 'Only the person who blocked this connection can unblock it.');
            }

            $now = now();
            foreach ([$low, $high] as $row) {
                $row->state = 'declined';
                $row->blocked_by_id = null;
                $row->responded_at = $now;
                $row->save();
            }

            return $actor->id === $low->owner_id ? $low : $high;
        });
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function orderedIds(User $a, User $b): array
    {
        return $a->id < $b->id ? [$a->id, $b->id] : [$b->id, $a->id];
    }

    /**
     * Lock the mirrored pair for two user ids, lower-owner-id row first.
     * Both rows must already exist — callers that may be acting on a
     * not-yet-existing pair use `lockOrCreatePair()` instead.
     *
     * @return array{0: Connection, 1: Connection}
     */
    private function lockPair(int $userAId, int $userBId): array
    {
        $lowId = min($userAId, $userBId);
        $highId = max($userAId, $userBId);

        /** @var Connection $low */
        $low = Connection::query()->where('owner_id', $lowId)->where('peer_id', $highId)->lockForUpdate()->firstOrFail();
        /** @var Connection $high */
        $high = Connection::query()->where('owner_id', $highId)->where('peer_id', $lowId)->lockForUpdate()->firstOrFail();

        return [$low, $high];
    }

    /**
     * Same lock order as `lockPair()`, but creates a fresh `blocked` pair
     * when neither row exists yet — blocking someone you've never
     * connected to is legal and doesn't require a prior `request()`.
     *
     * @return array{0: Connection, 1: Connection}
     */
    private function lockOrCreatePair(int $userAId, int $userBId): array
    {
        $lowId = min($userAId, $userBId);
        $highId = max($userAId, $userBId);
        $now = now();

        /** @var Connection $low */
        $low = Connection::query()->where('owner_id', $lowId)->where('peer_id', $highId)->lockForUpdate()->first()
            ?? Connection::query()->create(['owner_id' => $lowId, 'peer_id' => $highId, 'state' => 'pending', 'requested_at' => $now]);
        /** @var Connection $high */
        $high = Connection::query()->where('owner_id', $highId)->where('peer_id', $lowId)->lockForUpdate()->first()
            ?? Connection::query()->create(['owner_id' => $highId, 'peer_id' => $lowId, 'state' => 'pending', 'requested_at' => $now]);

        return [$low, $high];
    }

    /**
     * The raw upsert §5 mandates. `excluded.*` is the ON CONFLICT clause's
     * standard alias for the row that would have been inserted — supported
     * identically by sqlite (>= 3.24, confirmed present at 3.51 in this
     * environment) and PostgreSQL, so this single statement is portable
     * across both drivers with no branching, unlike this codebase's
     * CREATE-TABLE migrations.
     */
    private function upsertRequestRow(int $ownerId, int $peerId, int $initiatorId, ?string $note, Carbon $now): void
    {
        DB::statement(
            <<<'SQL'
                INSERT INTO connections
                    (owner_id, peer_id, state, initiated_by_id, requested_at, responded_at, connected_at, note, created_at, updated_at)
                VALUES
                    (?, ?, 'pending', ?, ?, NULL, NULL, ?, ?, ?)
                ON CONFLICT (owner_id, peer_id) DO UPDATE SET
                    state = CASE
                        WHEN connections.state = 'blocked' THEN connections.state
                        WHEN connections.state = 'accepted' THEN connections.state
                        WHEN connections.state = 'pending' AND connections.initiated_by_id <> excluded.initiated_by_id THEN 'accepted'
                        ELSE 'pending'
                    END,
                    initiated_by_id = CASE
                        WHEN connections.state IN ('blocked', 'accepted') THEN connections.initiated_by_id
                        WHEN connections.state = 'pending' AND connections.initiated_by_id <> excluded.initiated_by_id THEN connections.initiated_by_id
                        ELSE excluded.initiated_by_id
                    END,
                    requested_at = CASE
                        WHEN connections.state IN ('blocked', 'accepted') THEN connections.requested_at
                        WHEN connections.state = 'pending' AND connections.initiated_by_id <> excluded.initiated_by_id THEN connections.requested_at
                        ELSE excluded.requested_at
                    END,
                    responded_at = CASE
                        WHEN connections.state = 'pending' AND connections.initiated_by_id <> excluded.initiated_by_id THEN excluded.updated_at
                        WHEN connections.state IN ('blocked', 'accepted') THEN connections.responded_at
                        ELSE NULL
                    END,
                    connected_at = CASE
                        WHEN connections.state = 'pending' AND connections.initiated_by_id <> excluded.initiated_by_id THEN excluded.updated_at
                        WHEN connections.state IN ('blocked', 'accepted') THEN connections.connected_at
                        ELSE NULL
                    END,
                    note = CASE
                        WHEN connections.state IN ('blocked', 'accepted') THEN connections.note
                        WHEN connections.state = 'pending' AND connections.initiated_by_id <> excluded.initiated_by_id THEN connections.note
                        ELSE excluded.note
                    END,
                    updated_at = excluded.updated_at
                SQL,
            [$ownerId, $peerId, $initiatorId, $now, $note, $now, $now]
        );
    }
}
