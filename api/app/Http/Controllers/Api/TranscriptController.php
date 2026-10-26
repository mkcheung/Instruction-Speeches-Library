<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Concerns\ResolvesLiveSpeech;
use App\Http\Controllers\Controller;
use App\Http\Requests\Transcript\SearchTranscriptsRequest;
use App\Http\Resources\SpeechSearchResource;
use App\Http\Resources\TranscriptResource;
use App\Models\SpeechTranscript;
use App\Services\Search\SpeechSearch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * STEP-09-captions.md §6.12 / the frozen STEP-09 backend contract §4, §7:
 * the read-only transcript projection and the cross-speech search.
 */
class TranscriptController extends Controller
{
    use ResolvesLiveSpeech;

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
                    'caption_revision' => null,
                    'updated_at' => null,
                ],
            ]);
        }

        return new JsonResponse([
            'transcript' => new TranscriptResource($transcript),
        ]);
    }

    /**
     * Literal title/description/transcript search over the caller's own
     * speeches. Reviewer access deliberately does not broaden this scope.
     */
    public function search(SearchTranscriptsRequest $request, SpeechSearch $search): JsonResponse
    {
        $speeches = $search->find($this->currentUser($request)->id, (string) $request->validated('q'));

        return new JsonResponse([
            'results' => SpeechSearchResource::collection($speeches),
        ]);
    }
}
