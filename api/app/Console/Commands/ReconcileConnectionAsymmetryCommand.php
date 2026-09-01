<?php

namespace App\Console\Commands;

use App\Models\Connection;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * MODERNIZATION_PLAN §6.7.2 / STEP-13-FROZEN-CONTRACT.md §7: the nightly
 * asymmetry reconciler. `connections` is stored as two mirrored rows per
 * pair; `App\Services\ConnectionService` keeps them in sync by always
 * locking/writing lower-user-id-first, but a half-written pair (a crashed
 * request mid-transaction, a bug, a direct DB write that skipped the
 * service) is a one-sided friendship users report as "the site is broken"
 * with nothing in the logs. This sweep finds and fixes exactly that.
 *
 * Two asymmetry shapes are detected and repaired:
 *  - **State mismatch**: both mirrored rows exist but disagree on `state`.
 *    Repaired by taking the more "resolved" state as authoritative — see
 *    `precedence()` below.
 *  - **Missing mirror**: one row exists with no counterpart at all.
 *    Repaired by creating the missing row from the existing one's fields
 *    (owner/peer swapped, `initiated_by_id`/`blocked_by_id` copied as-is
 *    since those carry the same value on both mirrored rows by design).
 *
 * Scheduled nightly (e2e: every minute) — see routes/console.php.
 */
class ReconcileConnectionAsymmetryCommand extends Command
{
    protected $signature = 'connections:reconcile-asymmetry';

    protected $description = 'Detect and repair connections pairs whose two mirrored rows disagree, or where one row exists without its mirror (§6.7.2).';

    /**
     * Precedence when two mirrored rows disagree on `state` — the more
     * "resolved" state wins, since a mismatch means one write landed and
     * its mirror did not, never that both writes landed with genuinely
     * different intents. `blocked` always wins (a safety-relevant state
     * must never be silently lost); otherwise `accepted` beats `pending`/
     * `declined` (an acceptance is a completed handshake, more resolved
     * than either the outstanding invite or after-the-fact severance it
     * would otherwise appear to conflict with).
     *
     * @var array<string, int>
     */
    private const PRECEDENCE = ['blocked' => 3, 'accepted' => 2, 'pending' => 1, 'declined' => 1];

    public function handle(): int
    {
        $mismatched = 0;
        $created = 0;

        DB::transaction(function () use (&$mismatched, &$created) {
            // Every row, paired against its mirror (if any), locked for the
            // duration of this sweep so a concurrent ConnectionService write
            // can't race the repair.
            $rows = Connection::query()->lockForUpdate()->get(['id', 'owner_id', 'peer_id', 'state', 'initiated_by_id', 'blocked_by_id', 'note', 'requested_at', 'responded_at', 'connected_at']);
            $byPair = $rows->keyBy(fn (Connection $row) => $row->owner_id.':'.$row->peer_id);

            foreach ($rows as $row) {
                $mirrorKey = $row->peer_id.':'.$row->owner_id;
                /** @var Connection|null $mirror */
                $mirror = $byPair->get($mirrorKey);

                if ($mirror === null) {
                    // Create the missing mirror regardless of which side
                    // (lower- or higher-owner-id) is the one that survived —
                    // an asymmetry can leave either side as the sole
                    // remaining row (e.g. a direct DB write that skipped
                    // ConnectionService, or a crash between the two upsert
                    // statements). Safe to do unconditionally here: this
                    // loop iterates over the ORIGINAL `$rows` snapshot taken
                    // before any repair in this sweep, so a pair is visited
                    // at most once regardless of which of its two possible
                    // owner_id values shows up first — no double-create risk.
                    $new = Connection::query()->create([
                        'owner_id' => $row->peer_id,
                        'peer_id' => $row->owner_id,
                        'state' => $row->state,
                        'initiated_by_id' => $row->initiated_by_id,
                        'blocked_by_id' => $row->blocked_by_id,
                        'note' => $row->note,
                        'requested_at' => $row->requested_at,
                        'responded_at' => $row->responded_at,
                        'connected_at' => $row->connected_at,
                    ]);
                    $byPair->put($mirrorKey, $new);
                    $created++;
                    $this->warn("Created missing mirror for connection #{$row->id} ({$row->owner_id} <-> {$row->peer_id}).");

                    continue;
                }

                if ($mirror->state !== $row->state) {
                    $winner = self::PRECEDENCE[$row->state] >= self::PRECEDENCE[$mirror->state] ? $row : $mirror;
                    $loser = $winner === $row ? $mirror : $row;

                    if ($loser->state !== $winner->state) {
                        $loser->state = $winner->state;
                        $loser->initiated_by_id = $winner->initiated_by_id;
                        $loser->blocked_by_id = $winner->blocked_by_id;
                        $loser->connected_at = $winner->connected_at;
                        $loser->save();
                        $mismatched++;
                        $this->warn("Resolved state mismatch on connections #{$row->id}/#{$mirror->id}: both set to '{$winner->state}'.");
                    }
                }
            }
        });

        $this->info("Reconciled {$mismatched} mismatched pair(s) and created {$created} missing mirror row(s).");

        return self::SUCCESS;
    }
}
