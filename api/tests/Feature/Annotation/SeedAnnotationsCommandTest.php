<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Illuminate\Support\Facades\Artisan;

it('writes exactly 3 fixture annotations, two of them overlapping, and is idempotent on re-run', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
    ]);

    Artisan::call('annotations:seed', ['review' => $review->id]);

    $rows = Annotation::query()->where('review_id', $review->id)->orderBy('start_seconds')->get();
    expect($rows)->toHaveCount(3);
    expect($rows->every(fn (Annotation $a) => $a->published_at !== null))->toBeTrue();

    // The demo script's "at 1:02 two notes overlap": the second and third
    // fixture rows must overlap in [start, end).
    $second = $rows[1];
    $third = $rows[2];
    $secondEnd = (float) $second->start_seconds + (float) $second->duration_seconds;
    expect((float) $third->start_seconds)->toBeLessThan($secondEnd);

    // Re-running must not create duplicates (idempotent via the
    // deterministic client_uuid + partial unique index).
    Artisan::call('annotations:seed', ['review' => $review->id]);
    expect(Annotation::query()->where('review_id', $review->id)->count())->toBe(3);
});

it('fails cleanly for an unknown review id', function () {
    $exitCode = Artisan::call('annotations:seed', ['review' => 999999]);

    expect($exitCode)->not->toBe(0);
});

/**
 * Regression coverage for the seeder half-transition found in review: it
 * published the ROWS but left the REVIEW at its prior status, so STEP-06's
 * demo script 403'd at step 2 ("pick that reviewer") — the exact click the
 * script tells you to make.
 */
it('marks the review published so the speaker can actually open the seeded track', function () {
    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
    ]);

    Artisan::call('annotations:seed', ['review' => $review->id]);

    $review->refresh();
    expect($review->status)->toBe('published');
    expect($review->first_published_at)->not->toBeNull();
    expect($review->last_published_at)->not->toBeNull();
    expect($review->annotations_count)->toBe(3);
    expect($review->published_annotations_count)->toBe(3);

    // Counters are recomputed, not incremented, so a re-run can never drift
    // past the `published_annotations_count <= annotations_count` CHECK.
    $firstPublishedAt = $review->first_published_at;
    Artisan::call('annotations:seed', ['review' => $review->id]);

    $review->refresh();
    expect($review->annotations_count)->toBe(3);
    expect($review->published_annotations_count)->toBe(3);
    expect($review->first_published_at->timestamp)->toBe($firstPublishedAt->timestamp);
});
