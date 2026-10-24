<?php

namespace App\Services;

use App\Models\User;
use App\Support\ConnectionEligibility;
use DateTimeImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use stdClass;

final class FriendDirectoryService
{
    private const PAGE_SIZE = 20;

    public function __construct(private readonly ConnectionEligibility $eligibility) {}

    /**
     * @return array{rows: Collection<int, stdClass>, mutual: array<int, int>, total: int, next_cursor: ?string}
     */
    public function friends(User $viewer, string $view, string $search, ?string $cursor): array
    {
        $this->eligibility->assertActor($viewer);
        $position = $this->decodeCursor($cursor, $viewer->id, $view, $search);
        $column = $view === 'incoming' ? 'requested_at' : 'connected_at';
        $state = $view === 'incoming' ? 'pending' : 'accepted';
        $query = $this->people()->join('connections as mine', 'mine.peer_id', '=', 'users.id')
            ->where('mine.owner_id', $viewer->id)
            ->where('users.id', '<>', $viewer->id);
        $this->reciprocal($query, 'mine', 'mirror', $state);
        if ($view === 'incoming') {
            $query->whereColumn('mine.initiated_by_id', 'mine.peer_id');
        }
        if ($view === 'accepted' && $search !== '') {
            $this->search($query, $search);
        }

        // Bad historical timestamps have no truthful seek position. Exclude them
        // and flag the affected owner/view for reconciliation without returning IDs.
        if ((clone $query)->whereNull('mine.'.$column)->exists()) {
            Log::warning('Friends rows require timestamp reconciliation.', ['owner_id' => $viewer->id, 'view' => $view]);
        }
        $query->whereNotNull('mine.'.$column);
        $total = (clone $query)->count();
        if ($position !== null) {
            $query->where(function (Builder $seek) use ($column, $position): void {
                $seek->where('mine.'.$column, '<', $position['at'])
                    ->orWhere(function (Builder $tie) use ($column, $position): void {
                        $tie->where('mine.'.$column, '=', $position['at'])->where('mine.id', '<', $position['id']);
                    });
            });
        }
        $rows = $query->select('users.id as person_id', 'users.username', 'profiles.avatar_path',
            'mine.id as connection_id', 'mine.requested_at', 'mine.connected_at', 'mine.note')
            ->selectRaw($this->eligibility->nameExpression().' as person_name')
            ->orderByDesc('mine.'.$column)->orderByDesc('mine.id')->limit(self::PAGE_SIZE + 1)->get();
        $more = $rows->count() > self::PAGE_SIZE;
        $rows = $rows->take(self::PAGE_SIZE)->values();
        $last = $rows->last();
        $next = $more && $last !== null
            ? $this->encodeCursor($viewer->id, $view, $search, (int) $last->connection_id, (string) $last->{$column})
            : null;

        return ['rows' => $rows, 'mutual' => $this->mutualCounts($viewer->id, $this->personIds($rows)),
            'total' => $total, 'next_cursor' => $next];
    }

    /** @return array{rows: Collection<int, stdClass>, mutual: array<int, int>, next_cursor: ?string} */
    public function find(User $viewer, string $search, ?string $cursor): array
    {
        $this->eligibility->assertActor($viewer);
        $position = $this->decodeCursor($cursor, $viewer->id, 'find', $search);
        if ($search === '') {
            return ['rows' => collect(), 'mutual' => [], 'next_cursor' => null];
        }
        $query = $this->people()->where('users.id', '<>', $viewer->id);
        $this->search($query, $search);
        $query->where(function (Builder $sendable) use ($viewer): void {
            // A wholly absent pair is sendable; a single missing mirror is not.
            $sendable->where(function (Builder $absent) use ($viewer): void {
                $absent->whereNotExists($this->edge($viewer->id, true))
                    ->whereNotExists($this->edge($viewer->id, false));
            })->orWhereExists(function (Builder $declined) use ($viewer): void {
                $declined->selectRaw('1')->from('connections as previous')
                    ->where('previous.owner_id', $viewer->id)->whereColumn('previous.peer_id', 'users.id');
                $this->reciprocal($declined, 'previous', 'previous_mirror', 'declined');
            });
        });
        if ($position !== null) {
            $query->where('users.id', '>', $position['id']);
        }
        $rows = $query->select('users.id as person_id', 'profiles.avatar_path')
            ->selectRaw($this->eligibility->nameExpression().' as person_name')
            ->orderBy('users.id')->limit(self::PAGE_SIZE + 1)->get();
        $more = $rows->count() > self::PAGE_SIZE;
        $rows = $rows->take(self::PAGE_SIZE)->values();
        $last = $rows->last();

        return ['rows' => $rows, 'mutual' => $this->mutualCounts($viewer->id, $this->personIds($rows)),
            'next_cursor' => $more && $last !== null
                ? $this->encodeCursor($viewer->id, 'find', $search, (int) $last->person_id, null) : null];
    }

    /** @return array{state: 'none'|'pending'|'accepted'|'unavailable', direction: 'incoming'|'outgoing'|null, connection_id: ?int, connected_at: ?string} */
    public function relationship(User $viewer, User $target): array
    {
        $this->eligibility->assertActor($viewer);
        $empty = ['state' => 'unavailable', 'direction' => null, 'connection_id' => null, 'connected_at' => null];
        if ($viewer->id === $target->id || ! $this->eligibility->isEligible($target->id)) {
            return $empty;
        }
        $rows = DB::table('connections')->where(function (Builder $query) use ($viewer, $target): void {
            $query->where(function (Builder $mine) use ($viewer, $target): void {
                $mine->where('owner_id', $viewer->id)->where('peer_id', $target->id);
            })->orWhere(function (Builder $theirs) use ($viewer, $target): void {
                $theirs->where('owner_id', $target->id)->where('peer_id', $viewer->id);
            });
        })->get();
        if ($rows->isEmpty()) {
            return array_replace($empty, ['state' => 'none']);
        }
        if ($rows->count() !== 2) {
            return $empty;
        }
        $mine = $rows->first(fn (stdClass $row): bool => (int) $row->owner_id === $viewer->id);
        $theirs = $rows->first(fn (stdClass $row): bool => (int) $row->owner_id === $target->id);
        if ($mine === null || $theirs === null || $mine->state !== $theirs->state
            || $mine->blocked_by_id !== null || $theirs->blocked_by_id !== null
            || $mine->initiated_by_id !== $theirs->initiated_by_id
            || ! in_array($mine->state, ['accepted', 'pending', 'declined'], true)) {
            return $empty;
        }
        $initiator = $mine->initiated_by_id === null ? null : (int) $mine->initiated_by_id;
        if (($initiator === null && $mine->state !== 'declined')
            || ($initiator !== null && ! in_array($initiator, [$viewer->id, $target->id], true))) {
            return $empty;
        }
        if ($mine->state === 'declined') {
            return array_replace($empty, ['state' => 'none']);
        }
        $at = $mine->state === 'accepted' ? $mine->connected_at : $mine->requested_at;
        if (! is_string($at) || ! $this->validTimestamp($at)) {
            return $empty;
        }

        return ['state' => $mine->state, 'direction' => $mine->state === 'pending'
            ? ($initiator === $viewer->id ? 'outgoing' : 'incoming') : null,
            'connection_id' => (int) $mine->id,
            'connected_at' => $mine->state === 'accepted' ? Carbon::parse($at)->toJSON() : null];
    }

    private function people(): Builder
    {
        return DB::table('users')->leftJoin('profiles', 'profiles.user_id', '=', 'users.id')
            ->whereIn('users.id', $this->eligibility->eligibleUserIds());
    }

    /** Both drivers explicitly fold both operands; PostgreSQL's locale determines Unicode behavior.
     * SQLite LOWER only folds ASCII: its tests cannot establish Unicode release parity.
     */
    private function search(Builder $query, string $search): void
    {
        $literal = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $search).'%';
        $query->whereRaw('LOWER('.$this->eligibility->nameExpression().") LIKE LOWER(?) ESCAPE '!'", [$literal]);
    }

    /** Apply the same fail-closed pair invariant to lists, discovery and both mutual paths. */
    private function reciprocal(Builder $query, string $edge, string $mirror, string $state): void
    {
        $query->join('connections as '.$mirror, function (JoinClause $join) use ($edge, $mirror): void {
            $join->on($mirror.'.owner_id', '=', $edge.'.peer_id')->on($mirror.'.peer_id', '=', $edge.'.owner_id');
        })->where($edge.'.state', $state)->where($mirror.'.state', $state)
            ->whereColumn($edge.'.owner_id', '<>', $edge.'.peer_id')
            ->whereNull($edge.'.blocked_by_id')->whereNull($mirror.'.blocked_by_id')
            ->where(function (Builder $initiator) use ($edge, $mirror, $state): void {
                $initiator->where(function (Builder $present) use ($edge, $mirror): void {
                    $present->whereColumn($edge.'.initiated_by_id', $mirror.'.initiated_by_id')
                        ->where(function (Builder $valid) use ($edge): void {
                            $valid->whereColumn($edge.'.initiated_by_id', $edge.'.owner_id')
                                ->orWhereColumn($edge.'.initiated_by_id', $edge.'.peer_id');
                        });
                });
                // block/unblock can legitimately leave two declined rows with no initiator.
                if ($state === 'declined') {
                    $initiator->orWhere(function (Builder $absent) use ($edge, $mirror): void {
                        $absent->whereNull($edge.'.initiated_by_id')->whereNull($mirror.'.initiated_by_id');
                    });
                }
            });
    }

    private function edge(int $viewerId, bool $outgoing): \Closure
    {
        return function (Builder $query) use ($viewerId, $outgoing): void {
            $query->selectRaw('1')->from('connections as existing')
                ->where($outgoing ? 'existing.owner_id' : 'existing.peer_id', $viewerId)
                ->whereColumn($outgoing ? 'existing.peer_id' : 'existing.owner_id', 'users.id');
        };
    }

    /** @param Collection<int, stdClass> $rows
     * @return list<int>
     */
    private function personIds(Collection $rows): array
    {
        return array_values($rows->map(fn (stdClass $row): int => (int) $row->person_id)->all());
    }

    /** @param list<int> $candidateIds
     * @return array<int, int>
     */
    private function mutualCounts(int $viewerId, array $candidateIds): array
    {
        if ($candidateIds === []) {
            return [];
        }
        $query = DB::table('connections as viewer_edge')
            ->join('connections as candidate_edge', 'candidate_edge.peer_id', '=', 'viewer_edge.peer_id')
            ->where('viewer_edge.owner_id', $viewerId)->whereIn('candidate_edge.owner_id', $candidateIds)
            ->where('viewer_edge.peer_id', '<>', $viewerId)
            ->whereColumn('candidate_edge.owner_id', '<>', 'viewer_edge.peer_id')
            ->whereIn('viewer_edge.peer_id', $this->eligibility->eligibleUserIds());
        $this->reciprocal($query, 'viewer_edge', 'viewer_mirror', 'accepted');
        $this->reciprocal($query, 'candidate_edge', 'candidate_mirror', 'accepted');
        $rows = $query->select('candidate_edge.owner_id as candidate_id')
            ->selectRaw('COUNT(DISTINCT viewer_edge.peer_id) as mutual_count')->groupBy('candidate_edge.owner_id')->get();
        $counts = [];
        foreach ($rows as $row) {
            $counts[(int) $row->candidate_id] = (int) $row->mutual_count;
        }

        return $counts;
    }

    private function encodeCursor(int $viewer, string $view, string $search, int $id, ?string $at): string
    {
        return base64_encode(json_encode(['v' => 1, 'viewer' => $viewer, 'view' => $view, 'search' => $search,
            'id' => $id, 'at' => $at], JSON_THROW_ON_ERROR));
    }

    /** @return array{id: int, at: ?string}|null */
    private function decodeCursor(?string $cursor, int $viewer, string $view, string $search): ?array
    {
        if ($cursor === null || $cursor === '') {
            return null;
        }
        $raw = base64_decode($cursor, true);
        $data = $raw === false ? null : json_decode($raw, true);
        if (! is_array($data) || ($data['v'] ?? null) !== 1 || ($data['viewer'] ?? null) !== $viewer
            || ($data['view'] ?? null) !== $view || ($data['search'] ?? null) !== $search
            || ! isset($data['id']) || ! is_int($data['id']) || $data['id'] < 1
            || ! array_key_exists('at', $data)
            || ($view === 'find' ? $data['at'] !== null : (! is_string($data['at']) || ! $this->validTimestamp($data['at'])))) {
            throw ValidationException::withMessages(['cursor' => 'This page cursor is invalid. Restart from the first page.']);
        }

        return ['id' => $data['id'], 'at' => $data['at']];
    }

    private function validTimestamp(string $value): bool
    {
        if (! preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/D', $value)) {
            return false;
        }
        $parsed = DateTimeImmutable::createFromFormat(str_contains($value, '.') ? '!Y-m-d H:i:s.u' : '!Y-m-d H:i:s', $value);
        $errors = DateTimeImmutable::getLastErrors();

        return $parsed !== false && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0));
    }
}
