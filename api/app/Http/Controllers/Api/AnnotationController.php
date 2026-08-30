<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\SpeechDeletedException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Annotation\CreateAnnotationRequest;
use App\Http\Requests\Annotation\ListAnnotationsRequest;
use App\Http\Requests\Annotation\UpdateAnnotationRequest;
use App\Http\Resources\AnnotationResource;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Services\AnnotationService;
use App\Services\ReviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-06-watch-commentary.md (read) + STEP-07-write-commentary.md
 * (authoring). Every write method here derives the caller's OWN review
 * server-side from `(speech, $request->user())` — never a client-supplied
 * `review_id` — mirroring `NotificationController::markRead`'s "derive
 * from $request->user()" idiom. STEP-07's own text: "so no reviewer can
 * construct a URL targeting a peer".
 */
class AnnotationController extends Controller
{
    /**
     * `GET /speeches/{speech}/annotations?review_id=`. Track-selection
     * validation per §8.5: confirms `review_id` belongs to `$speech`
     * (404 if not — a review id for a different speech must not leak
     * whether it exists at all) and passes `readAnnotations` (403), then
     * rejects rather than silently falling back to "no commentary".
     *
     * STEP-07 additively widened this pre-existing STEP-06 endpoint's
     * status-code surface: `resolveSpeech()` now returns 410 (not 404) for
     * a speech id that WAS found but is soft-deleted, same as every write
     * route below. Callers that only expected 403/404/422 from this
     * endpoint should treat 410 as "gone", not an unhandled case.
     */
    public function index(ListAnnotationsRequest $request, string $speech, AnnotationService $annotations): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);

        $review = Review::query()->find($request->validated('review_id'));

        if ($review === null || $review->speech_id !== $speechModel->id) {
            return new JsonResponse(['message' => 'No such review.'], Response::HTTP_NOT_FOUND);
        }

        $this->authorize('readAnnotations', $review);

        $rows = $annotations->forReview($review, $request->user());

        return new JsonResponse([
            'review_id' => $review->id,
            // STEP-11-FROZEN-CONTRACT.md §9: same "Former reviewer" rule as
            // ReviewResource — a null `reviewer_id` means an erased
            // account, rendered as a literal label, never a stored
            // snapshot.
            // See ReviewResource's identical check for why `anonymized_at`
            // is checked alongside null — defense-in-depth against the
            // erasure race window AccountErasureService's start-of-job gate
            // stamp closes in the ordinary path.
            'reviewer' => ($review->reviewer === null || $review->reviewer->anonymized_at !== null)
                ? ['display_name' => 'Former reviewer']
                : [
                    'id' => $review->reviewer->id,
                    'username' => $review->reviewer->username,
                    'name' => trim("{$review->reviewer->first_name} {$review->reviewer->last_name}"),
                ],
            'annotations' => AnnotationResource::collection($rows),
        ]);
    }

    /**
     * `POST /speeches/{speech}/annotations` — create. 201 on a genuine new
     * row, 200 when `client_uuid` idempotently matched an existing live
     * row (see `AnnotationService::create`'s docblock).
     */
    public function store(CreateAnnotationRequest $request, string $speech, AnnotationService $annotations, ReviewService $reviews): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);
        $review = $reviews->findOwnReview($speechModel, $request->user());

        $this->authorize('annotation.create', $review);

        [$annotation, $wasCreated] = $annotations->create($review, $request->validated());

        return new JsonResponse([
            'annotation' => new AnnotationResource($annotation),
        ], $wasCreated ? Response::HTTP_CREATED : Response::HTTP_OK);
    }

    /**
     * `PATCH /speeches/{speech}/annotations/{annotation}` — retime/body/
     * duration/kind/topic. `$annotation` is implicit-bound (SoftDeletes'
     * default global scope already 404s a tombstoned row, which is
     * correct: an editable row is by definition a live one). Confirms the
     * row belongs to the CALLER's own review before authorizing, so a
     * reviewer can never even learn whether an annotation id belongs to a
     * peer's review (404, not 403).
     */
    public function update(UpdateAnnotationRequest $request, string $speech, Annotation $annotation, AnnotationService $annotations, ReviewService $reviews): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);
        $review = $reviews->findOwnReview($speechModel, $request->user());

        if ($annotation->review_id !== $review->id) {
            abort(Response::HTTP_NOT_FOUND, 'No such annotation.');
        }

        // Ownership is confirmed above BEFORE this check — `$annotation` is
        // implicit-bound with no ownership scoping of its own, so reading
        // `audio_asset_id` off it first (as an earlier version of this
        // method did) leaks, via 403-vs-404, whether an arbitrary
        // annotation id belongs to a live voice note on a peer's review —
        // exactly the oracle this method's own docblock promises never to
        // expose.
        if ($annotation->audio_asset_id !== null && ! $request->user()->hasVerifiedEmail()) {
            abort(Response::HTTP_FORBIDDEN, 'Your email address is not verified.');
        }

        // Already have this review loaded from the ownership check above —
        // attach it so AnnotationPolicy::update's `$annotation->review`
        // doesn't issue a second, redundant SELECT for the same row.
        $annotation->setRelation('review', $review);

        $data = $request->validated();
        if ($annotation->audio_asset_id !== null) {
            $forbidden = array_intersect(['start_seconds', 'duration_seconds', 'kind', 'topic'], array_keys($data));
            if ($forbidden !== []) {
                throw ValidationException::withMessages(array_fill_keys($forbidden, ['Voice-note timing and metadata are immutable.']));
            }
        }

        $this->authorize($annotation->audio_asset_id === null ? 'annotation.update' : 'voice.updateTranscript', $annotation);

        $updated = $annotations->update($annotation, $data);

        return new JsonResponse([
            'annotation' => new AnnotationResource($updated),
        ]);
    }

    /**
     * `DELETE /speeches/{speech}/annotations/{annotation}` — immediate
     * single-row soft-delete. Text annotation Undo re-`POST`s the original
     * payload and `client_uuid`; voice Undo restores this same tombstoned
     * row through VoiceAnnotationController::restore() before delayed
     * object purge claims its asset.
     */
    public function destroy(Request $request, string $speech, Annotation $annotation, AnnotationService $annotations, ReviewService $reviews): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);
        $review = $reviews->findOwnReview($speechModel, $request->user());

        if ($annotation->review_id !== $review->id) {
            abort(Response::HTTP_NOT_FOUND, 'No such annotation.');
        }

        // See update() above: ownership must be confirmed before this
        // check, or 403-vs-404 leaks whether an arbitrary annotation id
        // belongs to a live voice note on a peer's review.
        if ($annotation->audio_asset_id !== null && ! $request->user()->hasVerifiedEmail()) {
            abort(Response::HTTP_FORBIDDEN, 'Your email address is not verified.');
        }

        // See update() above: avoids a redundant SELECT of the same review
        // row inside AnnotationPolicy::delete.
        $annotation->setRelation('review', $review);

        $this->authorize($annotation->audio_asset_id === null ? 'annotation.delete' : 'voice.delete', $annotation);

        $annotations->delete($annotation);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /**
     * `DELETE /speeches/{speech}/annotation-sets/me` — clearAnnotations.
     * Exactly as STEP-07 specifies: no `authorId`/`review_id` parameter of
     * any kind. Routed through `ReviewService`, not `AnnotationService`,
     * per STEP-07's own grouping of `clearAnnotations` with `abandon`.
     */
    public function clearMine(Request $request, string $speech, ReviewService $reviews): JsonResponse
    {
        $speechModel = $this->resolveSpeech($speech);
        $review = $reviews->findOwnReview($speechModel, $request->user());

        $this->authorize('review.clearAnnotations', $review);

        $reviews->clearAnnotations($review);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /**
     * STEP-07: 410 Gone (not 404) when `$speechId` names a speech that WAS
     * found but is soft-deleted — "deleting a speech mid-annotation" per
     * the acceptance list. A truly nonexistent id still 404s via the
     * normal `ModelNotFoundException` `findOrFail` already throws,
     * unchanged. Every annotation route resolves `{speech}` through this
     * method rather than relying on implicit route-model binding
     * (`Speech $speech`), because implicit binding's default trashed
     * exclusion makes "found but trashed" indistinguishable from "never
     * existed" before the controller ever sees it.
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
