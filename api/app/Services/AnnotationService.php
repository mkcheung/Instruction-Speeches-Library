<?php

namespace App\Services;

use App\Exceptions\AnnotationCapExceededException;
use App\Exceptions\AnnotationConflictException;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * MODERNIZATION_PLAN §8.5: "The speaker must never see a coach's drafts,
 * and that cannot be a controller's responsibility." This is the
 * repository layer §8.5 insists on — AnnotationController never touches
 * Annotation::scopeVisibleTo directly, only this service.
 *
 * STEP-07-write-commentary.md additively extends this from a read-only
 * repository into the write path too: create/update/delete, all following
 * ReviewService's own `DB::transaction` + `lockForUpdate()` pattern.
 */
class AnnotationService
{
    public function __construct(private readonly ReviewService $reviews) {}

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

    /**
     * `POST /speeches/{speech}/annotations`. Idempotent on `client_uuid`
     * scoped to the caller's LIVE rows — mirrors `ReviewService::invite`'s
     * idempotent-upsert style: a matching live row already existing is not
     * an error, it's the same request arriving twice (retry, or the
     * frontend's Undo re-`POST`). The default Eloquent query already
     * excludes soft-deleted rows, so a tombstoned row with the same
     * `client_uuid` is correctly invisible here and falls through to a
     * genuine re-create, which is exactly what makes "delete then Undo"
     * work without colliding against its own tombstone (the partial unique
     * index is scoped to `WHERE deleted_at IS NULL` for the same reason).
     *
     * The ≤200-per-set cap (§10.4) is checked against the counter cache
     * under the SAME `lockForUpdate()` this method already takes, never a
     * live `COUNT(*)`. `recordAnnotationActivity` runs in this same
     * transaction, not as a follow-up query.
     *
     * @param  array{client_uuid: string, body: string, start_seconds: float|string, duration_seconds?: float|string|null, kind?: string|null, topic?: string|null}  $data
     * @return array{0: Annotation, 1: bool} [$annotation, $wasFreshlyCreated]
     */
    public function create(Review $review, array $data): array
    {
        return DB::transaction(function () use ($review, $data) {
            /** @var Review $locked */
            $locked = Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();

            /** @var Annotation|null $existing */
            $existing = Annotation::query()
                ->where('review_id', $locked->id)
                ->where('client_uuid', $data['client_uuid'])
                ->first();

            if ($existing !== null) {
                return [$existing, false];
            }

            if ($locked->annotations_count >= 200) {
                throw new AnnotationCapExceededException;
            }

            $annotation = Annotation::query()->create([
                'review_id' => $locked->id,
                'client_uuid' => $data['client_uuid'],
                'body' => $data['body'],
                'start_seconds' => $data['start_seconds'],
                'duration_seconds' => $data['duration_seconds'] ?? 6.0,
                'kind' => $data['kind'] ?? 'observation',
                'topic' => $data['topic'] ?? null,
            ]);

            $this->reviews->recordAnnotationActivity($locked);

            return [$annotation, true];
        });
    }

    /**
     * `PATCH /speeches/{speech}/annotations/{annotation}`. §10.2's
     * optimistic lock: the row is re-fetched under `lockForUpdate()`
     * (never trusting the instance the controller already loaded, which
     * may be stale) and its CURRENT `lock_version` is compared against the
     * one the client submitted. A mismatch throws
     * `AnnotationConflictException`, carrying the current row so the 409
     * body needs no second round trip.
     *
     * @param  array{lock_version: int, body?: string, start_seconds?: float|string, duration_seconds?: float|string, kind?: string, topic?: string|null}  $data
     */
    public function update(Annotation $annotation, array $data): Annotation
    {
        return DB::transaction(function () use ($annotation, $data) {
            /** @var Annotation $locked */
            $locked = Annotation::query()->whereKey($annotation->id)->lockForUpdate()->firstOrFail();

            if ($locked->lock_version !== (int) $data['lock_version']) {
                throw new AnnotationConflictException($locked);
            }

            $locked->fill(array_intersect_key($data, array_flip([
                'body', 'start_seconds', 'duration_seconds', 'kind', 'topic',
            ])));
            $locked->lock_version++;
            $locked->save();

            return $locked;
        });
    }

    /**
     * `DELETE /speeches/{speech}/annotations/{annotation}`. Single-row
     * soft-delete on a MODEL INSTANCE (never a bulk query-builder delete),
     * so Eloquent's `deleting` event actually fires and
     * `Annotation::booted()`'s listener decrements the review's counters
     * in this same transaction. Undo is not a server concern — see that
     * model's own comment and `AnnotationService::create()` above for why
     * re-`POST`ing the same `client_uuid` after this is an ordinary,
     * non-colliding create.
     */
    public function delete(Annotation $annotation): void
    {
        DB::transaction(function () use ($annotation) {
            $annotation->delete();
        });
    }
}
