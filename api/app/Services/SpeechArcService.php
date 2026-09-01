<?php

namespace App\Services;

use App\Models\Speech;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * MODERNIZATION_PLAN §6.11 — the recursive-CTE arc chain, bounded at depth
 * 10. Walks `speeches.supersedes_id` backward from a given speech in ONE
 * query rather than N, exactly the SQL §6.11 specifies.
 *
 * STEP-13-FROZEN-CONTRACT.md §10 / MODERNIZATION_PLAN §6.11's own closing
 * line: **"the chain is a relationship, not a grant."** Every row this
 * query returns is re-checked against `Speech::scopeVisibleTo` before any
 * title/date/change-note leaves this class — being told an earlier version
 * exists must never make it playable or reveal its content to a viewer who
 * holds no grant on it. This is the SAME invariant the
 * `VisibleToSnapshotTest` protects, applied at a second call site, per the
 * frozen contract's explicit warning that the snapshot test alone only
 * catches `scopeVisibleTo` itself being edited — a second, connections- or
 * chain-aware query that routes around it would still be a regression.
 */
class SpeechArcService
{
    private const MAX_DEPTH = 10;

    /**
     * @return list<array{id: int, ulid: string|null, title: string|null, delivered_on: string|null, change_note: string|null, depth: int, visible: bool}>
     */
    public function chainFor(int $speechId, User $viewer): array
    {
        $rows = DB::select(
            <<<'SQL'
                WITH RECURSIVE arc AS (
                    SELECT id, ulid, supersedes_id, title, delivered_on, change_note, 1 AS depth
                    FROM speeches WHERE id = ?
                    UNION ALL
                    SELECT s.id, s.ulid, s.supersedes_id, s.title, s.delivered_on, s.change_note, arc.depth + 1
                    FROM speeches s JOIN arc ON s.id = arc.supersedes_id
                    WHERE arc.depth < ?
                )
                SELECT * FROM arc ORDER BY depth
                SQL,
            [$speechId, self::MAX_DEPTH]
        );

        $ids = array_map(fn ($row) => (int) $row->id, $rows);
        $visibleIds = Speech::query()->visibleTo($viewer)->whereIn('id', $ids)->pluck('id')->all();
        $visibleIds = array_flip($visibleIds);

        return array_map(function ($row) use ($visibleIds) {
            $isVisible = isset($visibleIds[(int) $row->id]);

            return [
                'id' => (int) $row->id,
                'ulid' => $isVisible ? ($row->ulid ?? null) : null,
                // §6.11: "being shown that v2 exists never makes v2
                // playable" — an entry the viewer holds no grant on
                // surfaces only as a depth marker, never its title, date,
                // or change note.
                'title' => $isVisible ? $row->title : null,
                'delivered_on' => $isVisible ? $row->delivered_on : null,
                'change_note' => $isVisible ? $row->change_note : null,
                'depth' => (int) $row->depth,
                'visible' => $isVisible,
            ];
        }, $rows);
    }
}
