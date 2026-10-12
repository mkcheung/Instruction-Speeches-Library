<?php

use App\Models\Annotation;
use App\Models\AuditLog;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Notifications\ReviewAccessRevoked;
use App\Services\ReviewService;
use App\Support\AuditAction;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Notification;

/**
 * §7.2.5/§7.2.7 — the four audit writes and the one notification class
 * added to App\Services\ReviewService. None of withdraw/abandon/revoke/
 * revokeAndPurge wrote an audit row or sent a notification before this
 * change.
 */
it('writes a withdraw audit row with the reviewer as actor, only on the real transition', function () {
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $coach = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'accepted',
    ]);

    app(ReviewService::class)->withdraw($review, $coach);

    $log = AuditLog::query()->where('action', AuditAction::REVIEW_WITHDRAWN)->first();
    expect($log)->not->toBeNull();
    expect($log->actor_id)->toBe($coach->id);
    expect($log->subject_type)->toBe(Review::class);
    expect($log->subject_id)->toBe($review->id);
    expect($log->metadata['speech_id'])->toBe($speech->id);

    // A no-op retry (already declined) must not write a second row.
    app(ReviewService::class)->withdraw($review->fresh(), $coach);
    expect(AuditLog::query()->where('action', AuditAction::REVIEW_WITHDRAWN)->count())->toBe(1);
});

it('writes an abandon audit row with the reviewer as actor, only on the real transition', function () {
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $coach = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'in_progress',
    ]);

    app(ReviewService::class)->abandon($review, $coach);

    $log = AuditLog::query()->where('action', AuditAction::REVIEW_ABANDONED)->first();
    expect($log)->not->toBeNull();
    expect($log->actor_id)->toBe($coach->id);
    expect($log->subject_id)->toBe($review->id);

    // Retrying against an already-abandoned (or published-first) review
    // must not write a second row.
    app(ReviewService::class)->abandon($review->fresh(), $coach);
    expect(AuditLog::query()->where('action', AuditAction::REVIEW_ABANDONED)->count())->toBe(1);
});

it('writes a revoke audit row with the caller as actor, only on the real revoke (not an idempotent retry)', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $coach = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'published',
    ]);

    app(ReviewService::class)->revoke($review, $speaker, 'no longer needed');

    $log = AuditLog::query()->where('action', AuditAction::REVIEW_ACCESS_REVOKED)->first();
    expect($log)->not->toBeNull();
    expect($log->actor_id)->toBe($speaker->id);
    expect($log->subject_id)->toBe($review->id);
    expect($log->metadata)->toBe(['reason' => 'no longer needed', 'speech_id' => $speech->id]);

    // A no-op retry must not log a second row.
    app(ReviewService::class)->revoke($review->fresh(), $speaker, null);
    expect(AuditLog::query()->where('action', AuditAction::REVIEW_ACCESS_REVOKED)->count())->toBe(1);
});

it('writes a revokeAndPurge audit row with the actor the controller passes in, wiring up the previously-dead $actor parameter', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $coach = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'accepted',
    ]);
    $reviewId = $review->id;

    app(ReviewService::class)->revokeAndPurge($review, $speaker);

    $log = AuditLog::query()->where('action', AuditAction::REVIEW_ACCESS_PURGED)->first();
    expect($log)->not->toBeNull();
    expect($log->actor_id)->toBe($speaker->id);
    expect($log->subject_id)->toBe($reviewId);
    expect($log->metadata['speech_id'])->toBe($speech->id);
});

it('cascades annotations on revokeAndPurge and leaves the review row gone', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $coach = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'published',
    ]);
    $annotation = Annotation::factory()->for($review)->create();

    app(ReviewService::class)->revokeAndPurge($review, $speaker);

    expect(Review::find($review->id))->toBeNull();
    expect(Annotation::find($annotation->id))->toBeNull();
    expect(Annotation::withTrashed()->find($annotation->id))->toBeNull();
});

it('sends ReviewAccessRevoked to the reviewer on revoke, but not on withdraw, abandon, or an idempotent re-revoke retry', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $coach = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'accepted',
    ]);

    $revoked = app(ReviewService::class)->revoke($review, $speaker, 'reason one');

    Notification::assertSentTo($coach, ReviewAccessRevoked::class, function (ReviewAccessRevoked $notification) use ($review, $speech) {
        $data = $notification->toDatabase($notification);

        return $data['type'] === 'review.access_revoked'
            && $data['review_id'] === $review->id
            && $data['speech_id'] === $speech->id
            && $data['speech_title'] === $speech->title
            && $data['reason'] === 'reason one'
            && $data['purged'] === false
            && $data['url'] !== null;
    });

    // Retrying the already-revoked review must not send a second one.
    app(ReviewService::class)->revoke($revoked->fresh(), $speaker, null);
    Notification::assertSentToTimes($coach, ReviewAccessRevoked::class, 1);
});

it('sends ReviewAccessRevoked with purged=true and a null url on revokeAndPurge', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $coach = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'published',
    ]);
    $reviewId = $review->id;

    app(ReviewService::class)->revokeAndPurge($review, $speaker);

    Notification::assertSentTo($coach, ReviewAccessRevoked::class, function (ReviewAccessRevoked $notification) use ($reviewId, $speech) {
        $data = $notification->toDatabase($notification);

        return $data['type'] === 'review.access_revoked'
            && $data['review_id'] === $reviewId
            && $data['speech_id'] === $speech->id
            && $data['purged'] === true
            && $data['reason'] === null
            && $data['url'] === null;
    });
});

it('does not send ReviewAccessRevoked on withdraw or abandon', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $coachA = User::factory()->create();
    $coachB = User::factory()->create();
    $speech = Speech::factory()->for($speaker)->create();
    $reviewA = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coachA->id,
        'status' => 'accepted',
    ]);
    $reviewB = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coachB->id,
        'status' => 'in_progress',
    ]);

    app(ReviewService::class)->withdraw($reviewA, $coachA);
    app(ReviewService::class)->abandon($reviewB, $coachB);

    Notification::assertNothingSentTo($coachA);
    Notification::assertNothingSentTo($coachB);
});
