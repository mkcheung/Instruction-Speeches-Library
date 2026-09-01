<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Connection\CreateConnectionRequest;
use App\Http\Resources\ConnectionResource;
use App\Models\Connection;
use App\Models\Review;
use App\Models\User;
use App\Services\ConnectionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\Response;

/**
 * MODERNIZATION_PLAN §6.7.2 / STEP-13-FROZEN-CONTRACT.md §5/§9. Thin
 * controllers over App\Services\ConnectionService, matching ReviewController's
 * shape — every state transition lives in the service, not here.
 *
 * `{connection}` route-model-bound ids are ALWAYS resolved to the caller's
 * OWN mirrored row (`owner_id === $request->user()->id`) before any service
 * call — the same "never accept a client-supplied review_id belonging to
 * someone else" rule ReviewService::findOwnReview enforces, applied here at
 * the controller boundary since these four verbs don't have a
 * single-instance service lookup to centralize it in.
 */
class ConnectionController extends Controller
{
    public function store(CreateConnectionRequest $request, ConnectionService $connections): JsonResponse
    {
        $target = User::query()->findOrFail($request->validated('user_id'));

        $connection = $connections->request($request->user(), $target, $request->validated('note'));

        return new JsonResponse([
            'connection' => new ConnectionResource($connection->load('peer.profile')),
        ], Response::HTTP_CREATED);
    }

    public function accept(Request $request, Connection $connection, ConnectionService $connections): JsonResponse
    {
        $this->assertOwnRow($request, $connection);

        $updated = $connections->accept($request->user(), $connection->id);

        return new JsonResponse([
            'connection' => new ConnectionResource($updated->load('peer.profile')),
        ]);
    }

    public function decline(Request $request, Connection $connection, ConnectionService $connections): JsonResponse
    {
        $this->assertOwnRow($request, $connection);

        $updated = $connections->decline($request->user(), $connection->id);

        return new JsonResponse([
            'connection' => new ConnectionResource($updated->load('peer.profile')),
        ]);
    }

    public function block(Request $request, Connection $connection, ConnectionService $connections): JsonResponse
    {
        $this->assertOwnRow($request, $connection);
        Gate::authorize('connection.block', $connection);

        $peer = User::query()->findOrFail($connection->peer_id);
        $updated = $connections->block($request->user(), $peer);

        return new JsonResponse([
            'connection' => new ConnectionResource($updated->load('peer.profile')),
        ]);
    }

    public function unblock(Request $request, Connection $connection, ConnectionService $connections): JsonResponse
    {
        $this->assertOwnRow($request, $connection);

        $peer = User::query()->findOrFail($connection->peer_id);
        $updated = $connections->unblock($request->user(), $peer);

        return new JsonResponse([
            'connection' => new ConnectionResource($updated->load('peer.profile')),
        ]);
    }

    /**
     * `GET /connections` — the rail: accepted connections, cursor-paginated
     * (opaque base64 of `"{connected_at}|{id}"`, same shape §9 pins for the
     * timeline). The metric line (§6.7.4's five-row table) is computed for
     * the WHOLE page in exactly ONE aggregate query over `reviews` — R19's
     * own acceptance requirement, asserted by query count in
     * tests/Feature/Connection/ConnectionRailQueryCountTest.php, never
     * per-tile.
     *
     * `?state=pending` — the incoming-requests list. Found missing by the
     * STEP-13 reconciliation audit: without it, nothing in the app could
     * ever discover the id `POST /connections/{id}/accept` needs, so
     * STEP-13.md's own demo script ("Send someone a connection request.
     * They accept.") had no reachable path for the recipient's half.
     * Filters to `initiated_by_id != owner_id` — a row where *I* initiated
     * is my own outbound request sitting pending, nothing for me to act
     * on; only the mirror where someone else initiated is an incoming
     * request. No metric-line/GROUP BY needed here (§6.7.4's table already
     * gives the pending case one fixed string, no aggregate to compute).
     */
    public function index(Request $request): JsonResponse
    {
        $viewerId = $request->user()->id;
        $limit = 20;
        $state = $request->query('state', 'accepted');
        abort_unless(in_array($state, ['accepted', 'pending'], true), Response::HTTP_UNPROCESSABLE_ENTITY);

        $query = Connection::query()
            ->where('owner_id', $viewerId)
            ->where('state', $state)
            ->with('peer.profile');

        if ($state === 'pending') {
            $query->where('initiated_by_id', '!=', $viewerId)
                ->orderByDesc('requested_at')
                ->orderByDesc('id');
        } else {
            $query->orderByDesc('connected_at')->orderByDesc('id');
        }

        $sortColumn = $state === 'pending' ? 'requested_at' : 'connected_at';

        if ($cursor = self::decodeCursor($request->query('cursor'))) {
            [$cursorTs, $cursorId] = $cursor;
            $query->where(function ($q) use ($cursorTs, $cursorId, $sortColumn) {
                $q->where($sortColumn, '<', $cursorTs)
                    ->orWhere(function ($q2) use ($cursorTs, $cursorId, $sortColumn) {
                        $q2->where($sortColumn, $cursorTs)->where('id', '<', $cursorId);
                    });
            });
        }

        $rows = $query->limit($limit + 1)->get();
        $nextCursor = null;
        if ($rows->count() > $limit) {
            $rows = $rows->take($limit);
            /** @var Connection $last */
            $last = $rows->last();
            $nextCursor = self::encodeCursor((string) $last->{$sortColumn}, $last->id);
        }

        if ($state === 'pending') {
            $items = $rows->map(function (Connection $row) use ($request) {
                $data = (new ConnectionResource($row))->resolve($request);
                $data['metric'] = 'Wants to connect';

                return $data;
            })->values();

            return new JsonResponse([
                'connections' => $items,
                'meta' => ['next_cursor' => $nextCursor],
            ]);
        }

        $peerIds = $rows->pluck('peer_id')->all();
        $metrics = self::metricsFor($viewerId, $peerIds);

        // The metric line is attached to each resolved row's array output
        // here, not stored as a dynamic attribute on the Connection model
        // (Larastan's migration-AST column scanner only knows the model's
        // real DB columns, and this value is per-request-derived, not
        // persisted) — computed once in the single GROUP BY above,
        // attached per row afterward, never a second query per tile.
        $items = $rows->map(function (Connection $row) use ($metrics, $request) {
            $data = (new ConnectionResource($row))->resolve($request);
            $data['metric'] = self::metricLine($metrics[$row->peer_id] ?? null, $row->connected_at);

            return $data;
        })->values();

        return new JsonResponse([
            'connections' => $items,
            'meta' => ['next_cursor' => $nextCursor],
        ]);
    }

    /**
     * §6.7.4's rail metric, computed in ONE `GROUP BY` for every peer on
     * the current page — the single most likely N+1 in this feature (R19)
     * if this were run per tile instead. Strictly dyadic: every count comes
     * from a review row on which the viewer is one of the two named
     * parties, so it cannot leak a third party's existence.
     *
     * @param  list<int>  $peerIds
     * @return array<int, array{i_reviewed: int, they_reviewed: int}>
     */
    private static function metricsFor(int $viewerId, array $peerIds): array
    {
        if ($peerIds === []) {
            return [];
        }

        $rows = DB::table('reviews')
            ->selectRaw(
                'CASE WHEN reviewer_id = ? THEN speech_owner_id ELSE reviewer_id END AS other_id, '.
                'SUM(CASE WHEN reviewer_id = ? THEN 1 ELSE 0 END) AS i_reviewed, '.
                'SUM(CASE WHEN speech_owner_id = ? THEN 1 ELSE 0 END) AS they_reviewed',
                [$viewerId, $viewerId, $viewerId]
            )
            ->whereIn('status', Review::ACCESS_GRANTING)
            ->whereNull('revoked_at')
            ->where(function ($q) use ($viewerId, $peerIds) {
                $q->where(function ($q2) use ($viewerId, $peerIds) {
                    $q2->where('reviewer_id', $viewerId)->whereIn('speech_owner_id', $peerIds);
                })->orWhere(function ($q2) use ($viewerId, $peerIds) {
                    $q2->where('speech_owner_id', $viewerId)->whereIn('reviewer_id', $peerIds);
                });
            })
            ->groupBy('other_id')
            ->get();

        $metrics = [];
        foreach ($rows as $row) {
            $metrics[(int) $row->other_id] = [
                'i_reviewed' => (int) $row->i_reviewed,
                'they_reviewed' => (int) $row->they_reviewed,
            ];
        }

        return $metrics;
    }

    /**
     * @param  array{i_reviewed: int, they_reviewed: int}|null  $metric
     */
    private static function metricLine(?array $metric, mixed $connectedAt): string
    {
        $iReviewed = $metric['i_reviewed'] ?? 0;
        $theyReviewed = $metric['they_reviewed'] ?? 0;

        if ($iReviewed > 0 && $theyReviewed > 0) {
            return ($iReviewed + $theyReviewed).' reviews together';
        }

        if ($iReviewed > 0) {
            return "You reviewed {$iReviewed}";
        }

        if ($theyReviewed > 0) {
            return "Reviewed {$theyReviewed} of yours";
        }

        // Never "0 reviews" (§6.7.4) — a zero reads as failure and the
        // relationship is real.
        return $connectedAt ? 'Connected '.Carbon::parse($connectedAt)->format('M Y') : 'Connected';
    }

    private function assertOwnRow(Request $request, Connection $connection): void
    {
        abort_unless($connection->owner_id === $request->user()->id, Response::HTTP_NOT_FOUND);
    }

    /**
     * @return array{0: string, 1: int}|null
     */
    private static function decodeCursor(?string $cursor): ?array
    {
        if ($cursor === null || $cursor === '') {
            return null;
        }

        $decoded = base64_decode($cursor, true);
        if ($decoded === false || ! str_contains($decoded, '|')) {
            return null;
        }

        [$ts, $id] = explode('|', $decoded, 2);

        return [$ts, (int) $id];
    }

    private static function encodeCursor(string $timestamp, int $id): string
    {
        return base64_encode("{$timestamp}|{$id}");
    }
}
