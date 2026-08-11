<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Speech\CreateSpeechRequest;
use App\Http\Resources\SpeechResource;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\SpeechService;
use Closure;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * "My speeches" and single-speech read/create. `show` is a two-tier read
 * as of STEP-05 (§7.3): non-existence and "not visible to you at all" both
 * 404 (don't confirm existence to a stranger), an invited-but-not-yet-
 * accepted reviewer gets a reduced metadata payload (no signed playback
 * URL — that still lives behind SpeechUploadController::playbackUrl,
 * gated separately by an access-granting review), and the owner or an
 * access-granting reviewer gets the full payload this endpoint always
 * returned pre-S5.
 */
class SpeechController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $speeches = $request->user()->speeches()
            ->with(self::eagerLoads())
            ->latest()
            ->paginate(20);

        return new JsonResponse([
            'speeches' => SpeechResource::collection($speeches),
            'meta' => [
                'current_page' => $speeches->currentPage(),
                'last_page' => $speeches->lastPage(),
                'total' => $speeches->total(),
            ],
        ]);
    }

    public function store(CreateSpeechRequest $request, SpeechService $speeches): JsonResponse
    {
        $speech = $speeches->create($request->user(), $request->validated());

        return new JsonResponse([
            'speech' => new SpeechResource($speech->load(self::eagerLoads())),
        ], Response::HTTP_CREATED);
    }

    public function show(Request $request, Speech $speech): JsonResponse
    {
        $user = $request->user();
        $isOwner = $speech->user_id === $user->id;

        // §7.3's own review row (if any) drives both tiers below — one
        // query, reused, rather than a visibility EXISTS check plus a
        // second separate query for the row's own status.
        $review = $isOwner ? null : Review::query()
            ->where('speech_id', $speech->id)
            ->where('reviewer_id', $user->id)
            ->whereNull('revoked_at')
            ->first();

        $isGranting = $review !== null && in_array($review->status, Review::ACCESS_GRANTING, true);

        // Not the owner, and either no live (non-revoked) review row at
        // all, or one that's neither granting nor still `invited`
        // (declined/abandoned) — don't confirm existence to a stranger.
        if (! $isOwner && ! $isGranting && ($review === null || $review->status !== 'invited')) {
            return new JsonResponse(['message' => 'No such speech.'], Response::HTTP_NOT_FOUND);
        }

        if ($isOwner || $isGranting) {
            return new JsonResponse([
                'speech' => new SpeechResource($speech->load(self::eagerLoads())),
            ]);
        }

        // Invited but not yet accepted: reduced metadata tier only —
        // title, duration, speaker's name, the invitation message. No
        // signed playback URL.
        $speech->loadMissing('user');

        return new JsonResponse([
            'speech' => [
                'id' => $speech->id,
                'ulid' => $speech->ulid,
                'title' => $speech->title,
                'duration_seconds' => $speech->duration_seconds,
                'speaker_name' => trim("{$speech->user->first_name} {$speech->user->last_name}"),
                'invitation_message' => $review->invitation_message,
                'review_status' => $review->status,
            ],
        ]);
    }

    /**
     * `assets` here is deliberately scoped to `kind IN ('poster','sprite')`
     * — SpeechResource's poster/sprite blocks (§9.5) need those rows, but a
     * blanket `with('assets')` would also drag in every `source`/`captions`
     * row this endpoint never serializes. `primaryVideo` stays a separate
     * named eager-load (unchanged from STEP-03) rather than folding video
     * into the same constrained `assets` load, since SpeechResource still
     * reads `primary_video` off that relation specifically.
     *
     * @return array<int|string, string|Closure(HasMany<SpeechAsset, Speech>): mixed>
     */
    private static function eagerLoads(): array
    {
        return [
            'primaryVideo',
            'supersedes',
            /** @param HasMany<SpeechAsset, Speech> $query */
            'assets' => fn (HasMany $query) => $query->whereIn('kind', ['poster', 'sprite']),
        ];
    }
}
