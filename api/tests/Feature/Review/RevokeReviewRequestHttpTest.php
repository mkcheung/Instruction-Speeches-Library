<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Notification;

/**
 * §7.2.5 — `RevokeReviewRequest`'s `Rule::requiredIf` against the
 * route-model-bound review's current `revoked_at`. The service-layer
 * version of "retry doesn't blank the stored reason" already exists
 * (ReviewServiceTest.php); this is the HTTP-layer version of the same
 * invariant, plus the 422/200 boundary the request class itself adds.
 */
it('requires a reason on a first revoke but not on a retry, and a retry does not blank the stored reason', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $coach = User::factory()->create();
    $coach->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'accepted',
    ]);

    // First revoke, no reason -> 422.
    $this->actingAs($speaker)->postJson("/api/reviews/{$review->id}/revoke", [])
        ->assertStatus(422)
        ->assertJsonValidationErrors('reason');

    expect($review->fresh()->revoked_at)->toBeNull();

    // First revoke, with a reason -> 200.
    $this->actingAs($speaker)->postJson("/api/reviews/{$review->id}/revoke", [
        'reason' => 'no longer needed',
    ])->assertOk();

    expect($review->fresh()->revoked_at)->not->toBeNull();
    expect($review->fresh()->revocation_reason)->toBe('no longer needed');

    // Retry (already revoked), no reason -> 200, not 422, and the stored
    // reason is not blanked.
    $this->actingAs($speaker)->postJson("/api/reviews/{$review->id}/revoke", [])
        ->assertOk();

    expect($review->fresh()->revocation_reason)->toBe('no longer needed');
});

/**
 * `revoke-and-purge` shares `RevokeReviewRequest` with plain `revoke` —
 * the dialog's "mandatory reason for both modes" requirement (§7.2.6,
 * following `ClearAnnotationsDialog`'s precedent) is only honest if the
 * endpoint actually requires and persists it, not just the plain-revoke
 * endpoint. Purge deletes the row, so there's no `revocation_reason`
 * column to assert against afterward — the audit log is the durable
 * record instead (`ReviewRevocationAuditTest.php` covers that directly).
 */
it('requires a reason on revoke-and-purge, same as plain revoke', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $coach = User::factory()->create();
    $coach->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'accepted',
    ]);

    $this->actingAs($speaker)->postJson("/api/reviews/{$review->id}/revoke-and-purge", [])
        ->assertStatus(422)
        ->assertJsonValidationErrors('reason');

    expect(Review::query()->whereKey($review->id)->exists())->toBeTrue();

    $this->actingAs($speaker)->postJson("/api/reviews/{$review->id}/revoke-and-purge", [
        'reason' => 'no longer needed',
    ])->assertNoContent();

    expect(Review::query()->whereKey($review->id)->exists())->toBeFalse();
});

/**
 * code-review finding: `revoke-and-purge` has no idempotent early-exit
 * guard (unlike `revoke`), so a review that was revoked earlier — with
 * its own stored reason — can still be purged fresh, later, as a wholly
 * separate destructive act. The shared `RevokeReviewRequest` rule must
 * not treat "already revoked" as "this is a retry, reason optional" for
 * the purge route the way it correctly does for plain revoke.
 */
it('still requires a fresh reason to purge a review that was already revoked earlier', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $coach = User::factory()->create();
    $coach->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'accepted', 'revoked_at' => now(), 'revoked_by_id' => $speaker->id,
        'revocation_reason' => 'revoked last week',
    ]);

    $this->actingAs($speaker)->postJson("/api/reviews/{$review->id}/revoke-and-purge", [])
        ->assertStatus(422)
        ->assertJsonValidationErrors('reason');

    expect(Review::query()->whereKey($review->id)->exists())->toBeTrue();

    $this->actingAs($speaker)->postJson("/api/reviews/{$review->id}/revoke-and-purge", [
        'reason' => 'cleaning up now',
    ])->assertNoContent();

    expect(Review::query()->whereKey($review->id)->exists())->toBeFalse();
});

/**
 * code-review finding: with `authorize()` hard-coded `true`, the
 * conditionally-required `reason` rule let an unauthorized stranger infer
 * a review's revocation state (422 vs. reaching the controller for a 403)
 * before any RBAC check ran. `authorize()` now gates on the same ability
 * the controller checks, so an unauthorized caller gets a uniform 403
 * regardless of the review's revocation state or whether `reason` was sent.
 */
it('denies a non-owner, non-admin stranger with a uniform 403 before the reason rule ever runs', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $coach = User::factory()->create();
    $coach->assignRole('coach');
    $stranger = User::factory()->create();
    $stranger->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->create([
        'speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id,
        'status' => 'accepted',
    ]);

    $this->actingAs($stranger)->postJson("/api/reviews/{$review->id}/revoke", [])
        ->assertForbidden();

    $this->actingAs($stranger)->postJson("/api/reviews/{$review->id}/revoke-and-purge", [])
        ->assertForbidden();
});
