<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Review;
use App\Models\User;
use App\Services\MediaUrlSigner;
use App\Services\SpeechArcService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * `GET /u/{username}/timeline` — MODERNIZATION_PLAN §6.7.3 /
 * STEP-13-FROZEN-CONTRACT.md §4/§9/§10.
 *
 * ⚠️ **`connections` never appears in this query.** The timeline is driven
 * ENTIRELY off `reviews` — "U's speeches on which V holds an
 * access-granting, unrevoked review, and nothing else" — because nothing
 * else is visible to V. This is the single highest-priority correctness
 * invariant in this step (see tests/Feature/Speech/VisibleToSnapshotTest.php
 * and this class's own test coverage): a connection routes a viewer to a
 * profile page, it never widens what that page can show. `connections`
 * would only ever be consulted here to decide whether the page is
 * reachable at all — a decision this controller deliberately leaves to the
 * frontend/route layer, matching §6.7.1's "routing table, not an ACL".
 *
 * `?tab=left` (default) is "reviews you left" — `reviewer_id = viewer`,
 * `speech_owner_id = profile user`, backed by `ix_reviews_timeline`.
 * `?tab=received` is the mirror — `speech_owner_id = viewer`,
 * `reviewer_id = profile user`, backed by `ix_reviews_incoming`. Two index
 * range scans, zero new grants (§6.7.3).
 */
class ProfileTimelineController extends Controller
{
    public function show(Request $request, string $username, SpeechArcService $arcs): JsonResponse
    {
        $profileUser = User::query()->where('username', $username)->first();

        if ($profileUser === null) {
            return new JsonResponse(['message' => 'No such user.'], Response::HTTP_NOT_FOUND);
        }

        $viewer = $request->user();
        $tab = $request->query('tab', 'left') === 'received' ? 'received' : 'left';
        $limit = 20;

        // DB::table(), not Review::query() — a plain query-builder row
        // (stdClass), not an Eloquent Review hydration, since half these
        // selected columns (speech_id/ulid/title/poster_*) don't belong to
        // `reviews` at all. Using the Eloquent builder here would make
        // Larastan check every alias below against Review's real columns.
        $query = DB::table('reviews')
            ->join('speeches', 'speeches.id', '=', 'reviews.speech_id')
            ->leftJoin('speech_assets as poster', function ($join) {
                $join->on('poster.speech_id', '=', 'speeches.id')
                    ->where('poster.kind', '=', 'poster')
                    ->where('poster.is_primary', '=', true)
                    ->where('poster.status', '=', 'ready');
            })
            ->whereIn('reviews.status', Review::ACCESS_GRANTING)
            ->whereNull('reviews.revoked_at')
            ->select([
                'reviews.id as review_id', 'reviews.status', 'reviews.published_annotations_count',
                'reviews.essay_published_at', 'reviews.last_transition_at',
                'speeches.id as speech_id', 'speeches.ulid', 'speeches.title', 'speeches.delivered_on',
                'speeches.duration_seconds', 'speeches.supersedes_id',
                'poster.disk as poster_disk', 'poster.path as poster_path', 'poster.width as poster_width', 'poster.height as poster_height',
            ])
            ->orderByDesc('reviews.last_transition_at')
            ->orderByDesc('reviews.id');

        if ($tab === 'left') {
            $query->where('reviews.reviewer_id', $viewer->id)->where('reviews.speech_owner_id', $profileUser->id);
        } else {
            $query->where('reviews.speech_owner_id', $viewer->id)->where('reviews.reviewer_id', $profileUser->id);
        }

        if ($cursor = self::decodeCursor($request->query('cursor'))) {
            [$cursorTs, $cursorId] = $cursor;
            $query->where(function ($q) use ($cursorTs, $cursorId) {
                $q->where('reviews.last_transition_at', '<', $cursorTs)
                    ->orWhere(function ($q2) use ($cursorTs, $cursorId) {
                        $q2->where('reviews.last_transition_at', $cursorTs)->where('reviews.id', '<', $cursorId);
                    });
            });
        }

        $rows = $query->limit($limit + 1)->get();
        $nextCursor = null;
        if ($rows->count() > $limit) {
            $rows = $rows->take($limit);
            $last = $rows->last();
            $nextCursor = self::encodeCursor((string) $last->last_transition_at, (int) $last->review_id);
        }

        $signer = app(MediaUrlSigner::class);

        $items = $rows->map(function ($row) use ($arcs, $viewer, $signer) {
            return [
                'review_id' => $row->review_id,
                'status' => $row->status,
                'last_transition_at' => $row->last_transition_at,
                'commentary' => [
                    'notes_count' => (int) $row->published_annotations_count,
                    'has_essay' => $row->essay_published_at !== null,
                ],
                'speech' => [
                    'id' => $row->speech_id,
                    'ulid' => $row->ulid,
                    'title' => $row->title,
                    'delivered_on' => $row->delivered_on,
                    'duration_seconds' => $row->duration_seconds,
                ],
                'poster' => $row->poster_path ? [
                    'url' => $signer->presign($row->poster_path, 3600),
                    'width' => $row->poster_width,
                    'height' => $row->poster_height,
                ] : null,
                // §6.11 / frozen contract §9: embedded per-review, not a
                // separate per-speech endpoint (avoids an N+1 mirroring
                // R19's rail warning). Only computed when this speech is
                // actually part of a chain.
                'arc' => $row->supersedes_id !== null ? $arcs->chainFor((int) $row->speech_id, $viewer) : null,
            ];
        })->values();

        return new JsonResponse([
            'timeline' => $items,
            'meta' => [
                'next_cursor' => $nextCursor,
                'tab' => $tab,
                'profile_username' => $profileUser->username,
            ],
        ]);
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
