<?php

use App\Exceptions\SelfReviewNotPermittedException;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Services\ReviewService;
use Illuminate\Support\Facades\Notification;

/**
 * Basic smoke coverage for STEP-05's core service. Not the full acceptance
 * suite (a separate pass covers concurrency/HTTP-level behavior) — just
 * enough to prove the migration, model, and the service's headline
 * behaviors (self-review refusal thrown from the service, idempotent
 * invite/accept, re-invite reuse) actually work end to end.
 */
it('throws SelfReviewNotPermittedException from the service, not a controller, when a speaker invites themselves', function () {
    Notification::fake();

    $speaker = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();

    expect(fn () => app(ReviewService::class)->invite($speaker, $speech, $speaker, null, false, false))
        ->toThrow(SelfReviewNotPermittedException::class);
});

it('invites a reviewer and the row is idempotent on a second invite call', function () {
    Notification::fake();

    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();

    $service = app(ReviewService::class);
    $first = $service->invite($speaker, $speech, $reviewer, 'Please take a look', true, false);
    $second = $service->invite($speaker, $speech, $reviewer, 'Please take a look', true, false);

    expect($first->id)->toBe($second->id);
    expect(Review::query()->where('speech_id', $speech->id)->where('reviewer_id', $reviewer->id)->count())->toBe(1);
});

it('reuses the existing row when re-inviting someone who declined', function () {
    Notification::fake();

    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();

    $service = app(ReviewService::class);
    $review = $service->invite($speaker, $speech, $reviewer, null, false, false);
    $service->decline($review);

    $reinvited = $service->invite($speaker, $speech, $reviewer, 'second try', false, false);

    expect($reinvited->id)->toBe($review->id);
    expect($reinvited->status)->toBe('invited');
    expect(Review::query()->where('speech_id', $speech->id)->where('reviewer_id', $reviewer->id)->count())->toBe(1);
});

it('accept is idempotent when called twice', function () {
    Notification::fake();

    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = app(ReviewService::class)->invite($speaker, $speech, $reviewer, null, false, false);

    $service = app(ReviewService::class);
    $first = $service->accept($review);
    $second = $service->accept($review->fresh());

    expect($first->status)->toBe('accepted');
    expect($second->status)->toBe('accepted');
    expect(Review::query()->count())->toBe(1);
});

/**
 * Strengthened concurrency coverage: two independently-fetched, unrelated
 * PHP object instances of the SAME row (simulating two concurrent
 * requests, each with its own model instance loaded fresh from the DB
 * rather than sharing in-memory state) both call accept(). This is the
 * meaningful version of the idempotency check — a naive implementation
 * that merely no-ops on an in-memory `$review->status` already being
 * 'accepted' would pass a test that reuses one PHP object across both
 * calls, but would NOT catch a caching bug where the second instance
 * doesn't realize it's already accepted. Reloading from the DB between
 * calls, and asserting the row count and both instances' final observed
 * status, catches that.
 */
it('accept is safe and idempotent under simulated concurrency with independently reloaded instances', function () {
    Notification::fake();

    $speaker = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $original = app(ReviewService::class)->invite($speaker, $speech, $reviewer, null, false, false);

    $service = app(ReviewService::class);

    // Two independent instances of the same row, as two concurrent request
    // handlers would each load their own copy via route-model binding.
    $instanceOne = Review::query()->findOrFail($original->id);
    $instanceTwo = Review::query()->findOrFail($original->id);

    $resultOne = $service->accept($instanceOne);
    $resultTwo = $service->accept($instanceTwo);

    expect($resultOne->status)->toBe('accepted');
    expect($resultTwo->status)->toBe('accepted');
    expect($resultOne->id)->toBe($resultTwo->id);

    // Exactly one row exists — no duplicate-key exception, no torn write.
    expect(Review::where('speech_id', $speech->id)->where('reviewer_id', $reviewer->id)->count())->toBe(1);

    // The persisted row, reloaded fresh a third time, agrees with both
    // in-memory results rather than reflecting some intermediate state.
    $persisted = Review::query()->findOrFail($original->id);
    expect($persisted->status)->toBe('accepted');
    expect($persisted->responded_at)->not->toBeNull();

    // responded_at set by the FIRST accept call is not clobbered by the
    // second no-op call — the second call should return early without
    // resaving, so both `responded_at` timestamps should be identical
    // (not the second call's later `now()`).
    expect($resultOne->responded_at->equalTo($resultTwo->responded_at))->toBeTrue();
});

it('revoke sets revoked_at without changing status', function () {
    Notification::fake();

    $speaker = User::factory()->create();
    $review = Review::factory()->for($speaker, 'speechOwner')->published()->create(['speech_owner_id' => $speaker->id]);

    $revoked = app(ReviewService::class)->revoke($review, $speaker, 'no longer needed');

    expect($revoked->status)->toBe('published');
    expect($revoked->revoked_at)->not->toBeNull();
    expect($revoked->revocation_reason)->toBe('no longer needed');
});
