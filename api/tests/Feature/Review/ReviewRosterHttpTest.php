<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Services\ReviewService;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Notification;

/**
 * §7.2.3/§7.2.7 — `GET /speeches/{speech}/review-roster`.
 */
it('returns every review row regardless of status, while GET /reviews on the same fixture stays scoped to the access-granting subset', function () {
    // The house-rule-3 regression guard: both endpoints read the exact
    // same fixture in the same test, so the two sets of assertions can
    // never silently drift apart.
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');

    $invited = User::factory()->create();
    $invited->assignRole('member');
    $accepted = User::factory()->create();
    $accepted->assignRole('member');
    $published = User::factory()->create();
    $published->assignRole('member');
    $declined = User::factory()->create();
    $declined->assignRole('member');
    $abandoned = User::factory()->create();
    $abandoned->assignRole('member');
    $revoked = User::factory()->create();
    $revoked->assignRole('member');

    $speech = Speech::factory()->for($speaker)->create();

    $reviewInvited = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $invited->id,
        'status' => 'invited',
    ]);
    $reviewAccepted = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $accepted->id,
        'status' => 'accepted',
    ]);
    $reviewPublished = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $published->id,
        'status' => 'published',
    ]);
    $reviewDeclined = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $declined->id,
        'status' => 'declined',
    ]);
    $reviewAbandoned = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $abandoned->id,
        'status' => 'abandoned',
    ]);
    $reviewRevoked = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $revoked->id,
        'status' => 'accepted',
    ]);
    app(ReviewService::class)->revoke($reviewRevoked, $speaker, 'no longer needed');

    $roster = $this->actingAs($speaker)->getJson("/api/speeches/{$speech->id}/review-roster");
    $roster->assertOk();
    $rosterIds = collect($roster->json('reviews'))->pluck('id')->all();

    expect($rosterIds)->toHaveCount(6);
    foreach ([$reviewInvited, $reviewAccepted, $reviewPublished, $reviewDeclined, $reviewAbandoned, $reviewRevoked] as $review) {
        expect($rosterIds)->toContain($review->id);
    }

    // The roster row for the revoked reviewer carries the extra fields
    // ReviewResource does not have, and does not leak revoked_by_id.
    $revokedRow = collect($roster->json('reviews'))->firstWhere('id', $reviewRevoked->id);
    expect($revokedRow['revoked_at'])->not->toBeNull();
    expect($revokedRow['revocation_reason'])->toBe('no longer needed');
    expect($revokedRow['revoked_by_is_self'])->toBeTrue();
    expect($revokedRow)->not->toHaveKey('revoked_by_id');
    expect($revokedRow)->toHaveKeys(['annotations_count', 'published_annotations_count']);
    expect($revokedRow)->not->toHaveKey('speech');

    $forSpeech = $this->actingAs($speaker)->getJson("/api/speeches/{$speech->id}/reviews");
    $forSpeech->assertOk();
    $forSpeechIds = collect($forSpeech->json('reviews'))->pluck('id')->all();

    // Only the access-granting, non-revoked subset: accepted + published.
    // invited/declined/abandoned/revoked are all excluded.
    expect($forSpeechIds)->toHaveCount(2);
    expect($forSpeechIds)->toContain($reviewAccepted->id);
    expect($forSpeechIds)->toContain($reviewPublished->id);
    expect($forSpeechIds)->not->toContain($reviewInvited->id);
    expect($forSpeechIds)->not->toContain($reviewDeclined->id);
    expect($forSpeechIds)->not->toContain($reviewAbandoned->id);
    expect($forSpeechIds)->not->toContain($reviewRevoked->id);
});

it('refuses a non-owner the roster with 404, not 403', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $stranger = User::factory()->create();
    $stranger->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();

    $response = $this->actingAs($stranger)->getJson("/api/speeches/{$speech->id}/review-roster");

    $response->assertNotFound();
    expect($response->json('message'))->toBe('No such speech.');
});

it('sorts the roster by last_transition_at desc, id asc', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();

    $older = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id,
        'reviewer_id' => User::factory()->create()->id,
        'status' => 'invited', 'last_transition_at' => now()->subDay(),
    ]);
    $tieA = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id,
        'reviewer_id' => User::factory()->create()->id,
        'status' => 'invited', 'last_transition_at' => now(),
    ]);
    $tieB = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id,
        'reviewer_id' => User::factory()->create()->id,
        'status' => 'invited', 'last_transition_at' => now(),
    ]);

    $roster = $this->actingAs($speaker)->getJson("/api/speeches/{$speech->id}/review-roster");
    $ids = collect($roster->json('reviews'))->pluck('id')->all();

    $expectedTieOrder = $tieA->id < $tieB->id ? [$tieA->id, $tieB->id] : [$tieB->id, $tieA->id];
    expect($ids)->toBe([...$expectedTieOrder, $older->id]);
});
