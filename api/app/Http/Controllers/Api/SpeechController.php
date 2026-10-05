<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\SpeechAccessDeniedException;
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
 * "My speeches" and single-speech read/create. `show` is a four-tier read:
 * non-existence and "never had a review here" both 404 (don't confirm
 * existence to a stranger); a caller whose review no longer reaches the
 * speech — revoked, declined or abandoned — gets 403 (they were invited, so
 * existence is not news to them; see SpeechAccessDeniedException, added by
 * PLAN-ACCESS-DENIED-STATES.md, which also explains why those three are not
 * told apart); an invited-but-not-yet-accepted reviewer gets a reduced
 * metadata payload (no signed playback URL — that still lives behind
 * SpeechUploadController::playbackUrl, gated separately by an
 * access-granting review); and the owner or an access-granting reviewer gets
 * the full payload this endpoint always returned pre-S5.
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
        //
        // PLAN-ACCESS-DENIED-STATES.md §2.2: deliberately NO
        // `whereNull('revoked_at')` here any more. `uq_reviews_speech_reviewer`
        // (a real unique index, see the reviews migration) guarantees at most
        // one row per (speech, reviewer), and ReviewService::invite clears the
        // tombstone IN PLACE on re-invite rather than inserting a second row —
        // so dropping the filter cannot shadow a live grant, and there is
        // nothing to order by. Keeping the revoked row visible is precisely
        // what lets the denied tier below tell the truth instead of handing a
        // former reviewer the stranger's 404.
        $review = $isOwner ? null : Review::query()
            ->where('speech_id', $speech->id)
            ->where('reviewer_id', $user->id)
            ->first();

        $isLive = $review !== null && $review->revoked_at === null;
        $isGranting = $isLive && in_array($review->status, Review::ACCESS_GRANTING, true);

        // Never held a review here at all — or held one that was
        // revoke-and-purged, which hard-deletes the row and so correctly
        // returns this caller to stranger status. Don't confirm existence.
        // Unchanged from STEP-05 §7.3, and pinned by name in
        // ReviewInvitationHttpTest's "refuses a stranger with 404, not 403".
        if (! $isOwner && $review === null) {
            return new JsonResponse(['message' => 'No such speech.'], Response::HTTP_NOT_FOUND);
        }

        // Holds a row that no longer reaches the speech: revoked, declined or
        // abandoned. 403, not 404 — see SpeechAccessDeniedException for why,
        // including why all three collapse to one undifferentiated refusal
        // rather than being told apart.
        if (! $isOwner && ! $isGranting && ! ($isLive && $review->status === 'invited')) {
            throw new SpeechAccessDeniedException;
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
