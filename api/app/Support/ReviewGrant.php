<?php

namespace App\Support;

use App\Models\Review;
use Illuminate\Contracts\Database\Query\Builder;

/** Status and nonrevocation only; identity, roles and speech visibility remain caller rules. */
final class ReviewGrant
{
    public static function allows(Review $review): bool
    {
        return $review->revoked_at === null && in_array($review->status, Review::ACCESS_GRANTING, true);
    }

    /** @param ''|'reviews.' $prefix Code-owned column qualification, never request input. */
    public static function constrain(Builder $query, string $prefix = ''): void
    {
        $query->whereIn($prefix.'status', Review::ACCESS_GRANTING)->whereNull($prefix.'revoked_at');
    }
}
