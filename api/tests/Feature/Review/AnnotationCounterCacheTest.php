<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Services\AnnotationService;
use App\Services\ReviewService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * STEP-07-write-commentary.md / MODERNIZATION_PLAN §7.5, §8.4, §10.4.
 * Service-layer coverage of the counter-cache bookkeeping ReviewService
 * gained this step, plus the SQLite/PostgreSQL CHECK-constraint parity fix
 * to `ck_reviews_counters_nonnegative`.
 */
it('recordAnnotationActivity increments the counter and transitions accepted to in_progress on the first call only', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => Speech::factory()->for($speaker)->create()->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
    ]);
    expect($review->status)->toBe('accepted');
    expect($review->annotations_count)->toBe(0);

    $service = app(ReviewService::class);

    $afterFirst = $service->recordAnnotationActivity($review);
    expect($afterFirst->annotations_count)->toBe(1);
    expect($afterFirst->status)->toBe('in_progress');

    $afterSecond = $service->recordAnnotationActivity($afterFirst);
    expect($afterSecond->annotations_count)->toBe(2);
    expect($afterSecond->status)->toBe('in_progress'); // not re-transitioned
});

it('recordAnnotationActivity does not transition a review that was already in_progress or published on its first counted annotation', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $review = Review::factory()->published()->create([
        'speech_id' => Speech::factory()->for($speaker)->create()->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'annotations_count' => 0,
    ]);

    $updated = app(ReviewService::class)->recordAnnotationActivity($review);

    expect($updated->status)->toBe('published'); // untouched — only 'accepted' transitions
    expect($updated->annotations_count)->toBe(1);
});

it('publish sets published_annotations_count/first_published_at/last_published_at/status and returns zero on a rerun with nothing new', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => Speech::factory()->for($speaker)->create()->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'status' => 'in_progress',
    ]);
    Annotation::factory()->for($review)->draft()->create();
    Annotation::factory()->for($review)->draft()->create();
    $review->update(['annotations_count' => 2]);

    [$updated, $delta] = app(ReviewService::class)->publish($review);

    expect($delta)->toBe(2);
    expect($updated->published_annotations_count)->toBe(2);
    expect($updated->first_published_at)->not->toBeNull();
    expect($updated->last_published_at)->not->toBeNull();
    expect($updated->status)->toBe('published');

    [$updatedAgain, $deltaAgain] = app(ReviewService::class)->publish($updated->fresh());
    expect($deltaAgain)->toBe(0);
    expect($updatedAgain->published_annotations_count)->toBe(2);
});

it('publish does not clobber first_published_at on a later publish-additions call', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $review = Review::factory()->published()->create([
        'speech_id' => Speech::factory()->for($speaker)->create()->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'first_published_at' => now()->subWeek(),
        'last_published_at' => now()->subWeek(),
    ]);
    $originalFirstPublishedAt = $review->first_published_at;

    Annotation::factory()->for($review)->draft()->create();
    $review->update(['annotations_count' => 1]);

    [$updated, $delta] = app(ReviewService::class)->publish($review);

    expect($delta)->toBe(1);
    expect($updated->first_published_at->equalTo($originalFirstPublishedAt))->toBeTrue();
    expect($updated->last_published_at->greaterThan($originalFirstPublishedAt))->toBeTrue();
});

it('clearAnnotations resets both counters to zero and leaves status, the access grant and responded_at untouched', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => Speech::factory()->for($speaker)->create()->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'status' => 'in_progress',
    ]);
    Annotation::factory()->for($review)->create(['published_at' => now()]);
    Annotation::factory()->for($review)->draft()->create();
    $review->update(['annotations_count' => 2, 'published_annotations_count' => 1]);
    $respondedAt = $review->responded_at;

    $updated = app(ReviewService::class)->clearAnnotations($review);

    expect($updated->annotations_count)->toBe(0);
    expect($updated->published_annotations_count)->toBe(0);
    expect($updated->status)->toBe('in_progress');
    expect($updated->reviewer_id)->toBe($reviewer->id);
    expect($updated->revoked_at)->toBeNull();
    expect($updated->responded_at->equalTo($respondedAt))->toBeTrue();
    expect(Annotation::where('review_id', $review->id)->count())->toBe(0);
    expect(Annotation::withTrashed()->where('review_id', $review->id)->count())->toBe(2);
});

/**
 * AnnotationService::delete() decrements the counter cache via
 * Annotation::booted()'s `deleting` listener. Confirms it never underflows
 * even under a defensive max(0, ...) — and that this is belt-and-suspenders
 * over the CHECK constraint proven directly below, not a substitute for it.
 */
it('AnnotationService::delete decrements the counter cache and never underflows below zero', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => Speech::factory()->for($speaker)->create()->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'status' => 'in_progress',
        'annotations_count' => 0,
        'published_annotations_count' => 0,
    ]);
    // A row that predates the counter cache being accurate — deleting it
    // must clamp at zero, not go negative and trip the CHECK constraint.
    $annotation = Annotation::factory()->for($review)->create(['published_at' => now()]);

    app(AnnotationService::class)->delete($annotation->fresh());

    $fresh = $review->fresh();
    expect($fresh->annotations_count)->toBe(0);
    expect($fresh->published_annotations_count)->toBe(0);
});

/**
 * STEP-07's driver-parity fix: `ck_reviews_counters_nonnegative` used to
 * exist only on the PostgreSQL branch of the reviews migration, so a
 * counter-decrement bug could pass the SQLite-driven test suite (the one
 * this whole project runs against — phpunit.xml pins DB_CONNECTION=sqlite)
 * and only surface in production. This proves the SQLite branch now
 * enforces it too, by attempting the exact kind of write a decrement bug
 * would produce and confirming the database itself refuses it — not just
 * application code.
 */
it('the nonnegative counter CHECK constraint rejects a direct decrement below zero on the SQLite test driver', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => Speech::factory()->for($speaker)->create()->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'annotations_count' => 0,
        'published_annotations_count' => 0,
    ]);

    expect(fn () => DB::table('reviews')->where('id', $review->id)->update(['annotations_count' => -1]))
        ->toThrow(QueryException::class);

    expect(fn () => DB::table('reviews')->where('id', $review->id)->update(['published_annotations_count' => -1]))
        ->toThrow(QueryException::class);

    // The pre-existing counter-cache CHECK (published <= total) is
    // unaffected by this change — still enforced alongside the new one.
    expect(fn () => DB::table('reviews')->where('id', $review->id)->update(['published_annotations_count' => 5]))
        ->toThrow(QueryException::class);
});
