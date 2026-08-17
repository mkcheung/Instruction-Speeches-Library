<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\SpeechDeletedException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Transcript\SearchTranscriptsRequest;
use App\Http\Resources\SpeechResource;
use App\Http\Resources\TranscriptResource;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * STEP-09-captions.md §6.12 / the frozen STEP-09 backend contract §4, §7:
 * the read-only transcript projection and the cross-speech search.
 */
class TranscriptController extends Controller
{
    /**
     * `GET /speeches/{speech}/transcript`. Same read gate as
     * `CaptionController::show` (`caption.readCaptions` — owner OR an
     * access-granting reviewer): the transcript is the "authoritative
     * accessible surface" STEP-09.md names, so whoever can watch the
     * speech can read it.
     *
     * No transcript row yet (nothing generated or edited so far) returns
     * the same honest-empty-state shape as an unpublished essay/no
     * captions, rather than a 404 — this is an expected state for a
     * freshly-uploaded or captions-disabled speech.
     */
    public function show(Request $request, string $speech): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);

        $this->authorize('caption.readCaptions', $speechModel);

        $transcript = SpeechTranscript::query()->where('speech_id', $speechModel->id)->first();

        if ($transcript === null) {
            return new JsonResponse([
                'transcript' => [
                    'body' => '',
                    'segments' => [],
                    'word_count' => 0,
                    'words_per_minute' => null,
                    'language' => null,
                    'model' => null,
                    'source' => null,
                    'updated_at' => null,
                ],
            ]);
        }

        return new JsonResponse([
            'transcript' => new TranscriptResource($transcript),
        ]);
    }

    /**
     * `GET /speeches/search?q=...`. STEP-09.md's own wording: "Search
     * across your own speeches" — scoped to speeches the caller OWNS, not
     * every speech they can merely view as a reviewer (matching
     * `SpeechController::index`'s "my speeches" scope, `$request->user()
     * ->speeches()`, rather than the wider `Speech::scopeVisibleTo` a
     * reviewer would also satisfy).
     *
     * §7 of the frozen contract: a Postgres `tsvector`/GIN match, with a
     * plain `LIKE` fallback on SQLite (the phpunit-pinned test driver,
     * which has neither `tsvector` nor GIN) — both return the same
     * envelope shape, so nothing downstream needs to know which one ran.
     */
    public function search(SearchTranscriptsRequest $request): JsonResponse
    {
        $q = (string) $request->validated('q');
        $userId = $request->user()->id;
        $driver = DB::connection()->getDriverName();

        $speechIds = SpeechTranscript::query()
            ->whereHas('speech', fn ($query) => $query->where('user_id', $userId))
            ->when(
                $driver === 'pgsql',
                fn ($query) => $query->whereRaw("body_tsv @@ plainto_tsquery('english', ?)", [$q]),
                fn ($query) => $query->where('body', 'like', '%'.str_replace(['%', '_'], ['\%', '\_'], $q).'%'),
            )
            ->pluck('speech_id');

        $speeches = Speech::query()
            ->whereIn('id', $speechIds)
            ->with(self::eagerLoads())
            ->latest()
            ->get();

        return new JsonResponse([
            'results' => SpeechResource::collection($speeches),
        ]);
    }

    /**
     * Same shape as SpeechController::eagerLoads() — search results are
     * SpeechResource instances too, so they need the same constrained
     * `assets` load (poster/sprite only) to avoid an N+1 across the result
     * set.
     *
     * @return array<int|string, string|\Closure(HasMany<SpeechAsset, Speech>): mixed>
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

    /**
     * Identical to EssayController::resolveSpeech() / CaptionController::
     * resolveSpeech() — 410 Gone (not 404) for a speech id that WAS found
     * but is soft-deleted.
     */
    private function resolveSpeech(string $speechId): Speech
    {
        /** @var Speech $speech */
        $speech = Speech::withTrashed()->findOrFail($speechId);

        if ($speech->trashed()) {
            throw new SpeechDeletedException;
        }

        return $speech;
    }
}
