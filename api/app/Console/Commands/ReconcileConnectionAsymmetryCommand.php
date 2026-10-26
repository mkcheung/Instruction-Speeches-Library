<?php

namespace App\Console\Commands;

use App\Models\Connection;
use App\Support\ConnectionPair;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** Repairs historical mirrored pairs only when their resulting state and authority are unambiguous. */
class ReconcileConnectionAsymmetryCommand extends Command
{
    protected $signature = 'connections:reconcile-asymmetry';

    protected $description = 'Repair unambiguous connection asymmetries and report invalid pairs or missing timestamps.';

    /** Existing state policy; tied, differing states carry no authoritative winner.
     * @var array<string, int>
     */
    private const PRECEDENCE = ['blocked' => 3, 'accepted' => 2, 'pending' => 1, 'declined' => 1];

    public function handle(): int
    {
        $mismatched = 0;
        $created = 0;
        $aligned = 0;
        $attention = ['unresolved_pairs' => 0, 'accepted_missing_connected_at_rows' => 0, 'pending_missing_requested_at_rows' => 0];

        DB::transaction(function () use (&$mismatched, &$created, &$aligned, &$attention): void {
            // Retain the existing atomic full sweep. It locks existing rows only;
            // it does not participate in the service's advisory lock for absent rows.
            // A bounded per-pair/advisory-lock redesign needs separate contention evidence.
            $rows = Connection::query()->orderBy('owner_id')->orderBy('peer_id')->lockForUpdate()
                ->get(['id', 'owner_id', 'peer_id', 'state', 'initiated_by_id', 'blocked_by_id', 'note', 'requested_at', 'responded_at', 'connected_at']);
            $byPair = $rows->keyBy(fn (Connection $row): string => $row->owner_id.':'.$row->peer_id);
            $visited = [];

            foreach ($rows as $row) {
                $pairKey = min($row->owner_id, $row->peer_id).':'.max($row->owner_id, $row->peer_id);
                if (isset($visited[$pairKey])) {
                    continue;
                }
                $visited[$pairKey] = true;
                /** @var Connection|null $mirror */
                $mirror = $byPair->get($row->peer_id.':'.$row->owner_id);
                $candidate = $this->candidate($row, $mirror);
                if ($candidate === null) {
                    $attention['unresolved_pairs']++;

                    continue;
                }
                [$first, $second] = $candidate;
                if ($mirror === null) {
                    $this->saveInOrder($first, $second);
                    $created++;
                } elseif ($row->state !== $mirror->state) {
                    $this->saveInOrder($first, $second);
                    $mismatched++;
                } elseif ($first->isDirty() || $second->isDirty()) {
                    $this->saveInOrder($first, $second);
                    $aligned++;
                }
            }

            // Counts refer to stored rows after repairs, not distinct people or pairs.
            $attention['accepted_missing_connected_at_rows'] = Connection::query()->where('state', 'accepted')->whereNull('connected_at')->count();
            $attention['pending_missing_requested_at_rows'] = Connection::query()->where('state', 'pending')->whereNull('requested_at')->count();
        });

        if (array_sum($attention) > 0) {
            Log::warning('Connection reconciliation requires attention.', $attention);
            $this->warn("Reported {$attention['unresolved_pairs']} unresolved pair(s), {$attention['accepted_missing_connected_at_rows']} accepted row(s) without connected_at and {$attention['pending_missing_requested_at_rows']} pending row(s) without requested_at.");
        }
        $this->info("Reconciled {$mismatched} mismatched pair(s), aligned {$aligned} attribute-mismatched pair(s) and created {$created} missing mirror row(s).");

        return self::SUCCESS;
    }

    /** Build and validate both proposed rows without modifying either persisted model.
     * @return array{Connection, Connection}|null
     */
    private function candidate(Connection $row, ?Connection $mirror): ?array
    {
        $first = clone $row;
        $second = $mirror === null ? new Connection([
            'owner_id' => $row->peer_id,
            'peer_id' => $row->owner_id,
            'state' => $row->state,
            'initiated_by_id' => $row->initiated_by_id,
            'blocked_by_id' => $row->blocked_by_id,
            'note' => $row->note,
            'requested_at' => $row->requested_at,
            'responded_at' => $row->responded_at,
            'connected_at' => $row->connected_at,
        ]) : clone $mirror;
        $winner = $row;
        if ($mirror !== null && $row->state !== $mirror->state) {
            $rank = self::PRECEDENCE[$row->state] ?? null;
            $otherRank = self::PRECEDENCE[$mirror->state] ?? null;
            if ($rank === null || $otherRank === null || $rank === $otherRank) {
                return null;
            }
            $winner = $rank > $otherRank ? $row : $mirror;
        }

        // A non-null value can repair its missing copy, but differing values do
        // not establish who initiated or who owns the right to lift a block.
        if ($mirror !== null && $row->initiated_by_id !== null && $mirror->initiated_by_id !== null
            && $row->initiated_by_id !== $mirror->initiated_by_id) {
            return null;
        }
        if ($winner->state === 'blocked' && $mirror !== null && $row->blocked_by_id !== null && $mirror->blocked_by_id !== null
            && $row->blocked_by_id !== $mirror->blocked_by_id) {
            return null;
        }
        $attributes = [
            'state' => $winner->state,
            'initiated_by_id' => $row->initiated_by_id ?? $mirror?->initiated_by_id,
            'blocked_by_id' => $winner->state === 'blocked' ? ($row->blocked_by_id ?? $mirror?->blocked_by_id) : null,
        ];
        if ($mirror !== null && $row->state !== $mirror->state) {
            $attributes['connected_at'] = $winner->connected_at;
        }
        $first->forceFill($attributes);
        $second->forceFill($attributes);

        return ConnectionPair::isValid($first, $second) ? [$first, $second] : null;
    }

    private function saveInOrder(Connection $first, Connection $second): void
    {
        $ordered = $first->owner_id < $second->owner_id ? [$first, $second] : [$second, $first];
        foreach ($ordered as $side) {
            if (! $side->exists || $side->isDirty()) {
                $side->save();
            }
        }
    }
}
