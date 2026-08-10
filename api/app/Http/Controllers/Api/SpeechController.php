<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Speech\CreateSpeechRequest;
use App\Http\Resources\SpeechResource;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Services\SpeechService;
use Closure;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * "My speeches" and single-speech read/create. STEP-03 has no review-grant
 * mechanism yet (§6.3: that arrives in S5), so a speech is visible only to
 * its owner — a second Member gets 404, not 403, matching the "second
 * Member cannot fetch it" acceptance item's spirit (don't confirm existence
 * to a non-owner).
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
        if ($speech->user_id !== $request->user()->id) {
            return new JsonResponse(['message' => 'No such speech.'], Response::HTTP_NOT_FOUND);
        }

        return new JsonResponse([
            'speech' => new SpeechResource($speech->load(self::eagerLoads())),
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
