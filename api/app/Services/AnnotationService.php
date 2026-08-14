<?php

namespace App\Services;

use App\Models\Annotation;
use App\Models\Review;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;

/**
 * MODERNIZATION_PLAN §8.5: "The speaker must never see a coach's drafts,
 * and that cannot be a controller's responsibility." This is the
 * repository layer §8.5 insists on — AnnotationController never touches
 * Annotation::scopeVisibleTo directly, only this service.
 */
class AnnotationService
{
    /**
     * The exact set of rows visible to $user for $review, sorted
     * `ORDER BY start_seconds, id` per §6.3's "ordering is derived, never
     * stored" note — the `id` tie-break is not optional, it's what keeps
     * same-second annotations from jittering between requests.
     *
     * Caller MUST have already authorized `readAnnotations` for the review
     * — this method only decides which rows, not whether the caller may
     * see the set at all.
     *
     * @return Collection<int, Annotation>
     */
    public function forReview(Review $review, User $user): Collection
    {
        return Annotation::query()
            ->where('review_id', $review->id)
            ->visibleTo($user, $review)
            ->orderBy('start_seconds')
            ->orderBy('id')
            ->get();
    }
}
