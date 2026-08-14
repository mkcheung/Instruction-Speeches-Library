<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Annotation\ListAnnotationsRequest;
use App\Http\Resources\AnnotationResource;
use App\Models\Review;
use App\Models\Speech;
use App\Services\AnnotationService;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-06-watch-commentary.md — the frozen backend/frontend contract.
 * Read-only in this step: annotations are seeded by `annotations:seed`,
 * not authored through HTTP, until STEP-07.
 */
class AnnotationController extends Controller
{
    /**
     * `GET /speeches/{speech}/annotations?review_id=`. Track-selection
     * validation per §8.5: confirms `review_id` belongs to `$speech`
     * (404 if not — a review id for a different speech must not leak
     * whether it exists at all) and passes `readAnnotations` (403), then
     * rejects rather than silently falling back to "no commentary".
     */
    public function index(ListAnnotationsRequest $request, Speech $speech, AnnotationService $annotations): JsonResponse
    {
        $review = Review::query()->find($request->validated('review_id'));

        if ($review === null || $review->speech_id !== $speech->id) {
            return new JsonResponse(['message' => 'No such review.'], Response::HTTP_NOT_FOUND);
        }

        $this->authorize('readAnnotations', $review);

        $rows = $annotations->forReview($review, $request->user());

        return new JsonResponse([
            'review_id' => $review->id,
            'reviewer' => $review->reviewer === null ? null : [
                'id' => $review->reviewer->id,
                'name' => trim("{$review->reviewer->first_name} {$review->reviewer->last_name}"),
            ],
            'annotations' => AnnotationResource::collection($rows),
        ]);
    }
}
