<?php

namespace App\Services;

use App\Exceptions\ConnectionBlockedException;
use App\Exceptions\SelfConnectionNotPermittedException;
use App\Models\Connection;
use App\Models\User;
use App\Support\ConnectionEligibility;
use App\Support\ConnectionPair;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Two reciprocal rows form one connection. Every mutation serializes the pair
 * before reading its pre-state, then locks/writes lower-owner-id first.
 * PostgreSQL transaction advisory locks also cover wholly absent pairs, which
 * row locks cannot protect. SQLite serializes writers at the database level.
 *
 * Request keeps the atomic mirrored upserts for fresh, repeated, declined and
 * crossed requests. Both pre-state and resulting state are checked inside the
 * transaction: corrupt historical pairs are rejected, never silently repaired.
 */
class ConnectionService
{
    public function __construct(private readonly ConnectionEligibility $eligibility) {}

    /**
     * `POST /api/connections` — idempotent-upsert shaped, mirroring
     * `ReviewService::invite`'s own docblock pattern exactly: this one
     * endpoint handles "new request", "re-request after decline", and
     * "crossed request resolves to accepted", all as the same call.
     */
    public function request(User $requester, User $target, ?string $note): Connection
    {
        throw_if($requester->id === $target->id, SelfConnectionNotPermittedException::class, 'You cannot connect with yourself.');

        [$lowId, $highId] = $this->orderedIds($requester->id, $target->id);

        return DB::transaction(function () use ($lowId, $highId, $requester, $target, $note) {
            [$low, $high] = $this->lockOptionalPair($lowId, $highId);
            $this->eligibility->assertActor($requester);
            $this->eligibility->assertTarget($target);

            if ($low !== null || $high !== null) {
                [$low, $high] = $this->validatePair($low, $high);
                if ($low->state === 'blocked') {
                    throw new ConnectionBlockedException('This connection cannot be requested.');
                }
            }

            $now = now();
            $this->upsertRequestRow($lowId, $highId, $requester->id, $note, $now);
            $this->upsertRequestRow($highId, $lowId, $requester->id, $note, $now);
            [$low, $high] = $this->lockPair($lowId, $highId);

            return $this->sideOf($requester->id, $low, $high);
        });
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
            [$low, $high] = $this->lockOwnedPair($actor, $connectionId);
            $this->eligibility->assertActor($actor);

            $peerId = $actor->id === $low->owner_id ? $high->owner_id : $low->owner_id;
            $this->eligibility->assertTarget(User::query()->findOrFail($peerId));

            if ($low->state === 'accepted') {
                return $this->sideOf($actor->id, $low, $high);
            }

            if ($low->state !== 'pending' || $low->initiated_by_id === $actor->id) {
                // Not a pending inbound request for this actor (already
                // resolved another way, blocked, or this is the actor's own
                // outgoing request) — nothing to accept.
                abort(409, 'This request cannot be accepted.');
            }

            $now = now();
            $this->writePair($low, $high, ['state' => 'accepted', 'responded_at' => $now, 'connected_at' => $now]);

            return $this->sideOf($actor->id, $low, $high);
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
            [$low, $high] = $this->lockOwnedPair($actor, $connectionId);
            $this->eligibility->assertActor($actor);

            if ($low->state === 'declined') {
                return $this->sideOf($actor->id, $low, $high);
            }

            if ($low->state === 'blocked') {
                abort(409, 'This connection is blocked — unblock before declining.');
            }

            $now = now();
            $this->writePair($low, $high, ['state' => 'declined', 'responded_at' => $now]);

            return $this->sideOf($actor->id, $low, $high);
        });
    }

    /** Block severs only the connection; it never revokes existing reviews. */
    public function block(User $actor, User $target): Connection
    {
        throw_if($actor->id === $target->id, SelfConnectionNotPermittedException::class, 'You cannot block yourself.');

        return DB::transaction(function () use ($actor, $target) {
            [$low, $high] = $this->lockOrCreatePair($actor->id, $target->id);
            $this->eligibility->assertActor($actor);

            // A block belongs to whoever placed it. If the other party already
            // blocked this pair, rewriting `blocked_by_id` would hand the
            // blocked person ownership of that block: they could then
            // `unblock()` it and re-request around the original blocker's
            // decision. Leave the standing block untouched.
            if ($low->state === 'blocked' && $low->blocked_by_id !== $actor->id) {
                return $this->sideOf($actor->id, $low, $high);
            }

            $now = now();
            $this->writePair($low, $high, ['state' => 'blocked', 'blocked_by_id' => $actor->id, 'responded_at' => $now]);

            return $this->sideOf($actor->id, $low, $high);
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
            $this->eligibility->assertActor($actor);

            if ($low->state !== 'blocked') {
                abort(409, 'This connection is not blocked.');
            }

            if ($low->blocked_by_id !== $actor->id) {
                abort(403, 'Only the person who blocked this connection can unblock it.');
            }

            $now = now();
            $this->writePair($low, $high, ['state' => 'declined', 'blocked_by_id' => null, 'responded_at' => $now]);

            return $this->sideOf($actor->id, $low, $high);
        });
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function orderedIds(int $a, int $b): array
    {
        return $a < $b ? [$a, $b] : [$b, $a];
    }

    private function sideOf(int $actorId, Connection $low, Connection $high): Connection
    {
        return $actorId === $low->owner_id ? $low : $high;
    }

    /** @param array<string, mixed> $attributes */
    private function writePair(Connection $low, Connection $high, array $attributes): void
    {
        foreach ([$low, $high] as $row) {
            $row->forceFill($attributes)->save();
        }
    }

    /**
     * Resolve ownership without locking the actor's potentially higher row.
     * Recheck that exact row after taking the pair lock, including erasure races.
     *
     * @return array{0: Connection, 1: Connection}
     */
    private function lockOwnedPair(User $actor, int $connectionId): array
    {
        $selected = Connection::query()->where('owner_id', $actor->id)->whereKey($connectionId)->firstOrFail();
        [$low, $high] = $this->lockOptionalPair($actor->id, $selected->peer_id);
        $mine = $actor->id < $selected->peer_id ? $low : $high;
        abort_unless($mine !== null && $mine->id === $connectionId, 404);

        return $this->validatePair($low, $high);
    }

    /** @return array{0: Connection, 1: Connection} */
    private function lockPair(int $userAId, int $userBId): array
    {
        [$low, $high] = $this->lockOptionalPair($userAId, $userBId);

        return $this->validatePair($low, $high);
    }

    /**
     * The PostgreSQL pair lock is acquired before either SELECT, including when
     * neither row exists. Hash collisions only serialize unrelated pairs; the
     * same ordered pair always uses the same lock on every mutation path.
     *
     * @return array{0: ?Connection, 1: ?Connection}
     */
    private function lockOptionalPair(int $userAId, int $userBId): array
    {
        [$lowId, $highId] = $this->orderedIds($userAId, $userBId);
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['connections:'.$lowId.':'.$highId]);
        }

        $low = Connection::query()->where('owner_id', $lowId)->where('peer_id', $highId)->lockForUpdate()->first();
        $high = Connection::query()->where('owner_id', $highId)->where('peer_id', $lowId)->lockForUpdate()->first();

        return [$low, $high];
    }

    /**
     * Validate the entire pre-state before any transition can hide corruption.
     * Block/unblock of a fresh pair may legitimately leave a null initiator.
     *
     * @return array{0: Connection, 1: Connection}
     */
    private function validatePair(?Connection $low, ?Connection $high): array
    {
        abort_if($low === null || $high === null, 409, 'This connection is unavailable.');
        abort_unless(ConnectionPair::isValid($low, $high), 409, 'This connection is unavailable.');

        return [$low, $high];
    }

    /**
     * Only a wholly absent pair may be created. Existing partial pairs are left
     * untouched for reconciliation. Both new rows remain inside this transaction.
     *
     * @return array{0: Connection, 1: Connection}
     */
    private function lockOrCreatePair(int $userAId, int $userBId): array
    {
        [$low, $high] = $this->lockOptionalPair($userAId, $userBId);
        if ($low !== null || $high !== null) {
            return $this->validatePair($low, $high);
        }

        [$lowId, $highId] = $this->orderedIds($userAId, $userBId);
        $now = now();
        $low = Connection::query()->create(['owner_id' => $lowId, 'peer_id' => $highId, 'state' => 'blocked', 'blocked_by_id' => $userAId, 'requested_at' => $now]);
        $high = Connection::query()->create(['owner_id' => $highId, 'peer_id' => $lowId, 'state' => 'blocked', 'blocked_by_id' => $userAId, 'requested_at' => $now]);

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
