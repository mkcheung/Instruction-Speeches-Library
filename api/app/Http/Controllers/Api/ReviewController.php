<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Review\InviteReviewerRequest;
use App\Http\Requests\Review\RevokeReviewRequest;
use App\Http\Resources\ReviewResource;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Services\ReviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * MODERNIZATION_PLAN §6.3, §7.3, §7.5. Thin controllers over
 * App\Services\ReviewService — every state transition and the self-review
 * refusal live in the service, not here (§7.4: policies/controllers are
 * advisory, the service is the enforcement point).
 */
class ReviewController extends Controller
{
    /**
     * `POST /speeches/{speech}/reviews` — invite a reviewer (§6.3, §6.11).
     * Speech-owner only, via SpeechPolicy::invite.
     */
    public function invite(InviteReviewerRequest $request, Speech $speech, ReviewService $reviews): JsonResponse
    {
        $this->authorize('speech.invite', $speech);

        $reviewer = User::query()->findOrFail($request->validated('reviewer_id'));

        $review = $reviews->invite(
            speaker: $request->user(),
            speech: $speech,
            reviewer: $reviewer,
            message: $request->validated('message'),
            allowPreview: (bool) $request->boolean('allow_preview'),
            priorCommentaryShared: (bool) $request->boolean('prior_commentary_shared'),
        );

        return new JsonResponse([
            'review' => new ReviewResource($review),
        ], Response::HTTP_CREATED);
    }

    /**
     * `POST /reviews/{review}/accept` — idempotent (§7.5's concurrency
     * test fires this twice and expects one transition).
     */
    public function accept(Request $request, Review $review, ReviewService $reviews): JsonResponse
    {
        $this->authorize('review.accept', $review);

        return new JsonResponse([
            'review' => new ReviewResource($reviews->accept($review)),
        ]);
    }

    public function decline(Request $request, Review $review, ReviewService $reviews): JsonResponse
    {
        $this->authorize('review.decline', $review);

        return new JsonResponse([
            'review' => new ReviewResource($reviews->decline($review)),
        ]);
    }

    public function withdraw(Request $request, Review $review, ReviewService $reviews): JsonResponse
    {
        $this->authorize('review.withdraw', $review);

        return new JsonResponse([
            'review' => new ReviewResource($reviews->withdraw($review)),
        ]);
    }

    public function revoke(RevokeReviewRequest $request, Review $review, ReviewService $reviews): JsonResponse
    {
        $this->authorize('review.revoke', $review);

        return new JsonResponse([
            'review' => new ReviewResource($reviews->revoke($review, $request->user(), $request->validated('reason'))),
        ]);
    }

    public function revokeAndPurge(Request $request, Review $review, ReviewService $reviews): JsonResponse
    {
        $this->authorize('review.purge', $review);

        $reviews->revokeAndPurge($review, $request->user());

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    public function abandon(Request $request, Review $review, ReviewService $reviews): JsonResponse
    {
        $this->authorize('review.abandon', $review);

        return new JsonResponse([
            'review' => new ReviewResource($reviews->abandon($review)),
        ]);
    }

    /**
     * `POST /reviews/{review}/publish` — STEP-07-write-commentary.md.
     * Publish (and publish-additions, a re-run against an already-
     * `published` review) the caller's own draft rows. `published_count`
     * is the delta from THIS request only, not the cumulative total — the
     * demo script's "annotate three, press Publish, it shows a count".
     */
    public function publish(Request $request, Review $review, ReviewService $reviews): JsonResponse
    {
        $this->authorize('review.publish', $review);

        [$updated, $publishedCount] = $reviews->publish($review);

        return new JsonResponse([
            'published_count' => $publishedCount,
            'review' => new ReviewResource($updated),
        ]);
    }

    /**
     * `GET /reviews` — the reviewer dashboard (§7.5), four exact sorted
     * sections. `?section=` narrows to one; omitted returns all four
     * grouped, so the frontend can render the full dashboard in one call.
     */
    public function index(Request $request): JsonResponse
    {
        $reviewerId = $request->user()->id;
        $section = $request->query('section');
        $sections = [];

        if ($section === null || $section === 'invited') {
            $sections['invited'] = ReviewResource::collection(
                Review::query()
                    ->with('speech.user')
                    ->where('reviewer_id', $reviewerId)
                    ->where('status', 'invited')
                    ->whereNull('revoked_at')
                    ->orderBy('invited_at', 'asc')
                    ->get()
            );
        }

        if ($section === null || $section === 'in_progress') {
            $sections['in_progress'] = ReviewResource::collection(
                Review::query()
                    ->with('speech.user')
                    ->where('reviewer_id', $reviewerId)
                    ->whereIn('status', ['accepted', 'in_progress'])
                    ->whereNull('revoked_at')
                    ->orderBy('last_transition_at', 'asc')
                    ->get()
            );
        }

        if ($section === null || $section === 'published') {
            $sections['published'] = ReviewResource::collection(
                Review::query()
                    ->with('speech.user')
                    ->where('reviewer_id', $reviewerId)
                    ->where('status', 'published')
                    ->whereNull('revoked_at')
                    ->orderBy('last_transition_at', 'desc')
                    ->get()
            );
        }

        if ($section === null || $section === 'revoked') {
            $sections['revoked'] = ReviewResource::collection(
                Review::query()
                    ->with('speech.user')
                    ->where('reviewer_id', $reviewerId)
                    ->whereNotNull('revoked_at')
                    ->orderBy('last_transition_at', 'desc')
                    ->get()
            );
        }

        return new JsonResponse($sections);
    }

    /**
     * `GET /speeches/{speech}/reviews` — the speech owner's track-selector
     * data: reviewers whose review is in an access-granting status.
     * Owner-only; must never be reachable for a non-owner (§7.1's "nothing
     * tells A that B exists" applies just as much to the speech owner's own
     * endpoints leaking to a stranger).
     */
    public function forSpeech(Request $request, Speech $speech): JsonResponse
    {
        if ($speech->user_id !== $request->user()->id) {
            return new JsonResponse(['message' => 'No such speech.'], Response::HTTP_NOT_FOUND);
        }

        $reviews = $speech->reviews()
            ->with('reviewer')
            ->whereIn('status', Review::ACCESS_GRANTING)
            ->whereNull('revoked_at')
            ->orderBy('last_transition_at', 'desc')
            ->get();

        return new JsonResponse([
            'reviews' => ReviewResource::collection($reviews),
        ]);
    }
}
