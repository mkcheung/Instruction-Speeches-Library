<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\SpeechDeletedException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Essay\ShowEssayRequest;
use App\Http\Requests\Essay\UpdateEssayRequest;
use App\Http\Resources\EssayResource;
use App\Models\Review;
use App\Models\Speech;
use App\Services\EssayService;
use App\Services\ReviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-08-essay.md / the frozen STEP-08 backend contract. `update()` and
 * `publish()` derive the caller's OWN review server-side from `(speech,
 * $request->user())`, exactly like `AnnotationController`'s write methods —
 * never a client-supplied `review_id` — so no reviewer can construct a URL
 * targeting a peer's essay.
 */
class EssayController extends Controller
{
    /**
     * `GET /speeches/{speech}/essay?review_id=`. `review_id` is validated
     * to belong to `$speech` (404 if not, same as
     * `AnnotationController::index`), then `readAnnotations` decides
     * whether the caller may reach this review's essay AT ALL (author,
     * admin, or the speaker on an access-granting review; a peer reviewer
     * is refused here with a 403 before any row-level check runs).
     *
     * The row-level publish-gate on top of that (not delegated to
     * `readAnnotations`, which only answers the review-level question) per
     * the frozen contract: the author and an admin always see the real
     * `essay_html`/`essay_text`; the speaker sees them only once
     * `essay_published_at` is set — otherwise the response carries the
     * honest empty state (`essay_html: ''`, `essay_text: null`) rather
     * than a 403, mirroring the "hasn't left commentary yet" empty state
     * STEP-05/06 already use for an unpublished annotation set. The row
     * itself is never mutated — the
     * gate is applied to an in-memory clone before it reaches
     * `EssayResource`. Only `essay_html`/`essay_text` are masked — the
     * contract names exactly those two fields as gated; `essay_words`/
     * `essay_published_at`/`essay_updated_at`/`essay_lock_version` are not
     * listed as gated and are left visible.
     */
    public function show(ShowEssayRequest $request, string $speech): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);

        $review = Review::query()->find($request->validated('review_id'));

        if ($review === null || $review->speech_id !== $speechModel->id) {
            return new JsonResponse(['message' => 'No such review.'], Response::HTTP_NOT_FOUND);
        }

        $this->authorize('readAnnotations', $review);

        $user = $request->user();
        $isAuthor = $review->reviewer_id === $user->id;
        // Same owner exclusion as Annotation::scopeVisibleTo: an admin who
        // is also the speaker must be held to the speaker's rules, or they
        // read their own coach's UNPUBLISHED essay. Admin moderation of
        // someone else's speech is unaffected.
        $isAdmin = $user->hasRole('admin') && $review->speech_owner_id !== $user->id;
        $canSeeContent = $isAuthor || $isAdmin || $review->essay_published_at !== null;

        if (! $canSeeContent) {
            // Clone, never mutate the loaded model — this is a read-time
            // masking of the response, not a data change.
            $review = (clone $review);
            $review->essay_html = null;
            $review->essay_text = null;
        }

        return new JsonResponse([
            'essay' => new EssayResource($review),
        ]);
    }

    /**
     * `PUT /speeches/{speech}/essay` — autosave. 409 (via
     * `EssayConflictException`, thrown from `EssayService::update()`) on an
     * `essay_lock_version` mismatch.
     */
    public function update(UpdateEssayRequest $request, string $speech, EssayService $essays, ReviewService $reviews): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);
        $review = $reviews->findOwnReview($speechModel, $request->user());

        $this->authorize('essay.update', $review);

        $updated = $essays->update($review, $request->user(), $request->validated('html'), (int) $request->validated('lock_version'));

        return new JsonResponse([
            'essay' => new EssayResource($updated),
        ]);
    }

    /**
     * `POST /speeches/{speech}/essay/publish`. Idempotent — see
     * `EssayService::publish()`'s own docblock. 422 (via
     * `ValidationException`) when `essay_html` is blank.
     */
    public function publish(Request $request, string $speech, EssayService $essays, ReviewService $reviews): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);
        $review = $reviews->findOwnReview($speechModel, $request->user());

        $this->authorize('essay.publish', $review);

        $published = $essays->publish($review);

        return new JsonResponse([
            'essay' => new EssayResource($published),
        ]);
    }

    /**
     * Identical to `AnnotationController::resolveSpeech()` — 410 Gone (not
     * 404) for a speech id that WAS found but is soft-deleted, same status-
     * code surface across every essay route.
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
