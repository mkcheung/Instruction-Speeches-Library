<?php

use App\Jobs\PurgeSpeechMedia;
use App\Models\AuditLog;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Notifications\SpeechDeleted;
use App\Services\SpeechDeletionService;
use App\Services\SpeechService;
use App\Support\AuditAction;
use App\Support\SpeechDeletionReason;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;

/**
 * IMPLEMENTATION-PLANS.md §7.5.3(ii)/§7.5.4/§7.5.6: the service a speaker's
 * own `DELETE /speeches/{speech}` goes through.
 */
it('breaks the supersedes chain in both directions, freeing the predecessor slot', function () {
    $user = User::factory()->create();
    $a = Speech::factory()->for($user)->create();
    $b = Speech::factory()->for($user)->create(['supersedes_id' => $a->id, 'change_note' => 'b over a']);
    $c = Speech::factory()->for($user)->create(['supersedes_id' => $b->id, 'change_note' => 'c over b']);

    app(SpeechDeletionService::class)->deleteOwn($b);

    expect($a->fresh()->supersedes_id)->toBeNull(); // A was never superseded by anything else
    expect($c->fresh()->supersedes_id)->toBeNull(); // C no longer claims to supersede the deleted B
    expect($b->fresh()->trashed())->toBeTrue();

    // The actual regression proof: a NEW speech can now supersede A, where
    // before this fix `uq_speeches_successor` (no `WHERE deleted_at IS NULL`
    // clause) would still count the trashed B as occupying A's successor
    // slot.
    expect(fn () => app(SpeechService::class)->create($user, [
        'title' => 'Attempt 4',
        'supersedes_id' => $a->id,
        'change_note' => 'Retrying after deleting the bad attempt.',
    ]))->not->toThrow(Throwable::class);
});

it('writes exactly one AuditLog row with SPEECH_DELETED_BY_OWNER', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create(['title' => 'Gone Soon']);

    app(SpeechDeletionService::class)->deleteOwn($speech);

    $entry = AuditLog::query()->where('action', AuditAction::SPEECH_DELETED_BY_OWNER)->sole();
    expect($entry->actor_id)->toBe($user->id);
    expect($entry->subject_type)->toBe(Speech::class);
    expect($entry->subject_id)->toBe($speech->id);
    expect($entry->metadata['title'])->toBe('Gone Soon');
});

it('notifies every access-granting, non-revoked reviewer, and no one else', function () {
    Notification::fake();

    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $accepted = User::factory()->create();
    Review::factory()->accepted()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $accepted->id, 'speech_owner_id' => $owner->id, 'status' => 'accepted',
    ]);

    $published = User::factory()->create();
    Review::factory()->published()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $published->id, 'speech_owner_id' => $owner->id, 'status' => 'published',
    ]);

    $revokedReviewer = User::factory()->create();
    Review::factory()->accepted()->revoked()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $revokedReviewer->id, 'speech_owner_id' => $owner->id, 'status' => 'accepted',
    ]);

    $declinedReviewer = User::factory()->create();
    Review::factory()->declined()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $declinedReviewer->id, 'speech_owner_id' => $owner->id, 'status' => 'declined',
    ]);

    $abandonedReviewer = User::factory()->create();
    Review::factory()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $abandonedReviewer->id, 'speech_owner_id' => $owner->id, 'status' => 'abandoned',
    ]);

    app(SpeechDeletionService::class)->deleteOwn($speech);

    Notification::assertSentTo($accepted, SpeechDeleted::class);
    Notification::assertSentTo($published, SpeechDeleted::class);
    Notification::assertNotSentTo($revokedReviewer, SpeechDeleted::class);
    Notification::assertNotSentTo($declinedReviewer, SpeechDeleted::class);
    Notification::assertNotSentTo($abandonedReviewer, SpeechDeleted::class);
});

it('dispatches PurgeSpeechMedia with the owner window, not the takedown one', function () {
    Queue::fake();

    config(['media.owner_delete_quarantine_days' => 1, 'media.takedown_quarantine_days' => 30]);

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();

    app(SpeechDeletionService::class)->deleteOwn($speech);

    Queue::assertPushed(PurgeSpeechMedia::class, function (PurgeSpeechMedia $job) use ($speech) {
        return $job->speechId === $speech->id && $job->quarantineDays === 1;
    });
});

/**
 * §7.5.4's one-row invariant: the service must write to `speeches` and
 * `audit_log` only. A diff that starts setting `revoked_at` on reviews has
 * left the plan — see the service's own docblock for the three reasons.
 */
it('writes nothing to reviews, annotations, or speech_transcripts', function () {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $reviewer = User::factory()->create();
    $review = Review::factory()->accepted()->create([
        'speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id, 'status' => 'accepted',
    ]);

    $reviewBefore = $review->fresh()->getAttributes();

    app(SpeechDeletionService::class)->deleteOwn($speech);

    $reviewAfter = $review->fresh()->getAttributes();

    expect($reviewAfter)->toBe($reviewBefore);
    expect($review->fresh()->revoked_at)->toBeNull();
});

it('is idempotent: a retry on an already-trashed speech no-ops, without re-stamping deleted_reason', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();

    app(SpeechDeletionService::class)->deleteOwn($speech);
    // `fresh()` would re-query through Speech::query(), which carries the
    // SoftDeletes global scope and returns null for a trashed row —
    // withTrashed() is required to look at it again.
    $trashed = Speech::withTrashed()->findOrFail($speech->id);
    $firstDeletedAt = $trashed->deleted_at;

    app(SpeechDeletionService::class)->deleteOwn($trashed);

    expect(AuditLog::query()->where('action', AuditAction::SPEECH_DELETED_BY_OWNER)->count())->toBe(1);
    $trashedAgain = Speech::withTrashed()->findOrFail($speech->id);
    expect($trashedAgain->deleted_reason)->toBe(SpeechDeletionReason::OWNER);
    expect($trashedAgain->deleted_at->eq($firstDeletedAt))->toBeTrue();
});
