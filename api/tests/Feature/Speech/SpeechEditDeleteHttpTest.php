<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Support\SpeechDeletionReason;

/**
 * IMPLEMENTATION-PLANS.md §7.5.6/§7.5.7(b): `PATCH`/`DELETE /speeches/{speech}`.
 */
it('lets the owner update title/description/delivered_on/change_note', function () {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create(['title' => 'Old title']);

    $response = $this->actingAs($owner)->patchJson("/api/speeches/{$speech->id}", [
        'title' => 'New title',
        'description' => 'New description',
        'delivered_on' => '2026-01-01',
        'change_note' => 'Fixed the opening.',
    ]);

    $response->assertOk();
    $response->assertJsonPath('speech.title', 'New title');
    $response->assertJsonPath('speech.description', 'New description');
    $response->assertJsonPath('speech.change_note', 'Fixed the opening.');

    $fresh = $speech->fresh();
    expect($fresh->title)->toBe('New title');
    expect($fresh->description)->toBe('New description');
    expect($fresh->change_note)->toBe('Fixed the opening.');
});

it('rejects captions_enabled and supersedes_id on the PATCH payload', function () {
    $owner = User::factory()->create();
    $earlier = Speech::factory()->for($owner)->create();
    $speech = Speech::factory()->for($owner)->create();

    // Neither field is a validation rule here at all, so an unexpected key
    // is simply ignored rather than rejected — the real assertion is that
    // the write it could have triggered never happens.
    $response = $this->actingAs($owner)->patchJson("/api/speeches/{$speech->id}", [
        'title' => 'Still mine',
        'captions_enabled' => false,
        'supersedes_id' => $earlier->id,
    ]);

    $response->assertOk();
    $fresh = $speech->fresh();
    expect($fresh->captions_enabled)->toBeTrue(); // untouched, default-on
    expect($fresh->supersedes_id)->toBeNull(); // untouched — own route only
});

it('lets the owner delete their own speech, returning 204', function () {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $response = $this->actingAs($owner)->deleteJson("/api/speeches/{$speech->id}");

    $response->assertNoContent();
    expect($speech->fresh()->trashed())->toBeTrue();
    expect($speech->fresh()->deleted_reason)->toBe(SpeechDeletionReason::OWNER);
});

/**
 * §7.5.7(b)'s information-leak trap: a genuine stranger (never had any
 * review row on this speech) must get 404, matching show()'s stranger
 * branch — NOT Laravel's default 403, which would leak existence.
 */
it('returns 404, not 403, for a genuine stranger on PATCH and DELETE', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $this->actingAs($stranger)->patchJson("/api/speeches/{$speech->id}", ['title' => 'Nope'])
        ->assertNotFound()
        ->assertJsonPath('message', 'No such speech.');

    $this->actingAs($stranger)->deleteJson("/api/speeches/{$speech->id}")
        ->assertNotFound()
        ->assertJsonPath('message', 'No such speech.');

    expect($speech->fresh()->trashed())->toBeFalse();
});

/**
 * The other half of the same trap: a non-owner who HOLDS a review row —
 * even one that no longer grants access (revoked) — already structurally
 * knows the speech exists, so the refusal must be 403, not 404.
 */
it('returns 403, not 404, for a non-owner with a revoked review row', function () {
    $owner = User::factory()->create();
    $formerReviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->revoked()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $formerReviewer->id,
        'speech_owner_id' => $owner->id,
        'status' => 'accepted',
    ]);

    $this->actingAs($formerReviewer)->patchJson("/api/speeches/{$speech->id}", ['title' => 'Nope'])
        ->assertForbidden();

    $this->actingAs($formerReviewer)->deleteJson("/api/speeches/{$speech->id}")
        ->assertForbidden();

    expect($speech->fresh()->trashed())->toBeFalse();
});

it('is idempotent: a second DELETE on an already-trashed speech 410s via resolveSpeech, not an error', function () {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $this->actingAs($owner)->deleteJson("/api/speeches/{$speech->id}")->assertNoContent();

    $this->actingAs($owner)->deleteJson("/api/speeches/{$speech->id}")
        ->assertStatus(410);
});

it('410s PATCH and DELETE on an already-trashed speech instead of 404ing', function () {
    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $speech->delete();

    $this->actingAs($owner)->patchJson("/api/speeches/{$speech->id}", ['title' => 'Nope'])
        ->assertStatus(410);

    $this->actingAs($owner)->deleteJson("/api/speeches/{$speech->id}")
        ->assertStatus(410);
});

/**
 * code-review finding: `resolveSpeech()`'s 410 check used to run BEFORE
 * the stranger-tier check, so a genuine stranger probing a speech id that
 * had since been deleted got 410 — distinguishably different from a
 * never-existed id's 404 and from a live speech they have no relation
 * to's "No such speech" 404. That let an authenticated stranger
 * enumerate which ids used to exist and were deleted, exactly the leak
 * this whole file's stranger-404 test above exists to close for the
 * live-speech case. This pins the trashed-speech case too.
 */
it('returns 404, not 410, for a genuine stranger probing an already-deleted speech', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    $speech->delete();

    $this->actingAs($stranger)->patchJson("/api/speeches/{$speech->id}", ['title' => 'Nope'])
        ->assertStatus(404)
        ->assertJsonPath('message', 'No such speech.');

    $this->actingAs($stranger)->deleteJson("/api/speeches/{$speech->id}")
        ->assertStatus(404)
        ->assertJsonPath('message', 'No such speech.');
});
