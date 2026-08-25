<?php

namespace App\Models;

use Database\Factories\AnnotationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * MODERNIZATION_PLAN §6.3, §7.3, §8.2, §8.5. One row of a coach's
 * commentary on a review's video. `review_id NOT NULL` is the whole
 * attribution/authorization chain — see the migration's own comment.
 *
 * `@property` block below is not decorative: the `annotations` migration
 * is raw `DB::statement` SQL (needed for the `kind`/timing CHECKs and the
 * partial unique index — see the migration's own comment), so Larastan's
 * migration-AST column scanner cannot infer this model's columns the way
 * it does for a normal Blueprint table. Without this block every property
 * access below is an "undefined property" Larastan error.
 *
 * @property int $id
 * @property int $review_id
 * @property string $client_uuid
 * @property string $body
 * @property int|null $audio_asset_id
 * @property string $transcript_status
 * @property string|null $transcript_failure_code
 * @property string|null $transcript_attempt_id
 * @property string $start_seconds
 * @property string $duration_seconds
 * @property string $kind
 * @property string|null $topic
 * @property Carbon|null $published_at
 * @property int $lock_version
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Carbon|null $deleted_at
 */
#[Fillable([
    'review_id', 'client_uuid', 'body', 'start_seconds', 'duration_seconds',
    'kind', 'topic', 'published_at', 'lock_version', 'audio_asset_id',
    'transcript_status', 'transcript_failure_code', 'transcript_attempt_id',
])]
class Annotation extends Model
{
    /** @use HasFactory<AnnotationFactory> */
    use HasFactory, SoftDeletes;

    /**
     * @return BelongsTo<Review, $this>
     */
    public function review(): BelongsTo
    {
        return $this->belongsTo(Review::class);
    }

    /** @return BelongsTo<SpeechAsset, $this> */
    public function audioAsset(): BelongsTo
    {
        return $this->belongsTo(SpeechAsset::class, 'audio_asset_id');
    }

    /**
     * MODERNIZATION_PLAN §7.3/§8.5: row-level filtering of an already
     * review-gated set. This is deliberately NOT the authorization check —
     * `AnnotationPolicy::readAnnotations` answers "does this user get to
     * see ANY annotations for this review at all"; this scope answers
     * "which specific rows, once that gate has already passed". Called
     * only from App\Services\AnnotationService (§8.5: "that cannot be a
     * controller's responsibility" — one forgotten `where` here leaks a
     * coach's in-progress thinking to the person being assessed).
     *
     * - The author (the review's reviewer) sees every row, published or
     *   draft, published-after-published, all of it — including after
     *   revocation. `readAnnotations` already refuses a revoked coach at
     *   the review level (no rows come back at all), so this branch never
     *   needs to special-case revocation itself.
     * - Admin sees every row, unconditionally (§7.3: moderation).
     * - The speaker (anyone else who reaches this scope, which
     *   `readAnnotations` allows for any access-granting review status)
     *   sees only `published_at IS NOT NULL` rows. A draft written after
     *   publication must never appear here, however new it is — and on an
     *   `accepted`/`in_progress` review, where nothing is published yet,
     *   that makes this scope return the empty set rather than a leak.
     *
     * @param  Builder<Annotation>  $q
     * @return Builder<Annotation>
     */
    public function scopeVisibleTo(Builder $q, User $user, Review $review): Builder
    {
        if ($review->reviewer_id === $user->id || $user->hasRole('admin')) {
            return $q;
        }

        return $q->whereNotNull('published_at');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'start_seconds' => 'decimal:3',
            'duration_seconds' => 'decimal:3',
            'published_at' => 'datetime',
            'lock_version' => 'integer',
        ];
    }

    /**
     * STEP-07-write-commentary.md: single-row soft-delete must decrement
     * `reviews.annotations_count` (and `published_annotations_count` too,
     * if the row being deleted was published) in the SAME transaction as
     * the delete. A `deleting` model event is the only place this can
     * live and still fire for a real single-row delete — MODERNIZATION_
     * PLAN's own warning ("Eloquent's SoftDeletes never fires a database
     * ON DELETE CASCADE") generalizes to model events too: a BULK delete
     * (as `clearAnnotations` deliberately uses) skips this listener
     * entirely, which is why that method resets both counters directly
     * instead of relying on it. `App\Services\AnnotationService::delete()`
     * is the only caller expected to reach this listener, and it always
     * calls `$annotation->delete()` on a model instance, never a
     * query-builder bulk delete, specifically so this fires.
     */
    protected static function booted(): void
    {
        static::deleting(function (Annotation $annotation): void {
            /** @var Review|null $review */
            $review = Review::query()->whereKey($annotation->review_id)->lockForUpdate()->first();

            if ($review === null) {
                return;
            }

            $review->annotations_count = max(0, $review->annotations_count - 1);

            if ($annotation->published_at !== null) {
                $review->published_annotations_count = max(0, $review->published_annotations_count - 1);
            }

            $review->save();
        });
    }
}
