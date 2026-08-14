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
