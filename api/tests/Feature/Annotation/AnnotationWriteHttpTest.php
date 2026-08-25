<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Policies\AnnotationPolicy;
use App\Policies\ReviewPolicy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Str;

/**
 * STEP-07-write-commentary.md / MODERNIZATION_PLAN §8.4, §10.1, §10.2,
 * §10.4. HTTP-level coverage of the annotation authoring surface, against
 * the frozen backend/frontend contract.
 *
 * Deliberately self-contained rather than reusing AnnotationEndpointTest's
 * `makeAcceptedReview()` — depending on a same-named global function
 * declared in a DIFFERENT test file only works when both files happen to
 * be loaded in the same PHPUnit/Pest process (the whole-suite run), and
 * breaks with "Call to undefined function" the moment this file is run in
 * isolation (`pest tests/Feature/Annotation/AnnotationWriteHttpTest.php`).
 */
function acceptedInProgressReview(User $speaker, User $reviewer, ?Speech $speech = null): Review
{
    $speech ??= Speech::factory()->for($speaker)->create();

    return Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
        'status' => 'in_progress',
    ]);
}

function acceptedReview(User $speaker, User $reviewer, ?Speech $speech = null): Review
{
    $speech ??= Speech::factory()->for($speaker)->create();

    return Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
    ]);
}

function speakerAndCoach(): array
{
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');

    return [$speaker, $reviewer];
}

it('creates an annotation and is idempotent on client_uuid for the caller\'s own review', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $clientUuid = (string) Str::uuid();

    $payload = [
        'client_uuid' => $clientUuid,
        'body' => 'Great energy on the opening line.',
        'start_seconds' => 12.5,
        'duration_seconds' => 6.0,
        'kind' => 'praise',
        'topic' => 'delivery',
    ];

    $first = $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/annotations", $payload);
    $first->assertCreated();
    $first->assertJsonPath('annotation.client_uuid', $clientUuid);
    $first->assertJsonPath('annotation.lock_version', 0);

    $second = $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/annotations", $payload);
    $second->assertOk();
    $second->assertJsonPath('annotation.id', $first->json('annotation.id'));

    expect(Annotation::where('review_id', $review->id)->where('client_uuid', $clientUuid)->count())->toBe(1);
});

it('rejects a create once the review already has 200 live annotations', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);

    Annotation::factory()->count(200)->for($review)->create();
    $review->update(['annotations_count' => 200]);

    $response = $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/annotations", [
        'client_uuid' => (string) Str::uuid(),
        'body' => 'One too many.',
        'start_seconds' => 5.0,
    ]);

    $response->assertStatus(422);
    expect(Annotation::where('review_id', $review->id)->count())->toBe(200);
});

it('derives the caller\'s own review server-side and never accepts a review_id, so a reviewer cannot target a peer\'s review', function () {
    $this->seed(RoleSeeder::class);
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewerA = User::factory()->create();
    $reviewerA->assignRole('coach');
    $reviewerB = User::factory()->create();
    $reviewerB->assignRole('coach');

    $speech = Speech::factory()->for($speaker)->create();
    $reviewA = acceptedInProgressReview($speaker, $reviewerA, $speech);
    $reviewB = acceptedInProgressReview($speaker, $reviewerB, $speech);

    // Reviewer B posts against the SAME speech and deliberately sends
    // reviewer A's review id in the body; the endpoint has no review_id
    // field at all, so it can only ever write to reviewer B's own row.
    $response = $this->actingAs($reviewerB)->postJson("/api/speeches/{$speech->id}/annotations", [
        'review_id' => $reviewA->id,
        'client_uuid' => (string) Str::uuid(),
        'body' => 'Reviewer B\'s own note.',
        'start_seconds' => 1.0,
    ]);

    $response->assertCreated();
    $created = Annotation::where('client_uuid', $response->json('annotation.client_uuid'))->firstOrFail();
    expect($created->review_id)->toBe($reviewB->id);
    expect($created->review_id)->not->toBe($reviewA->id);
});

it('404s a write from a reviewer who holds no review at all on the target speech', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $stranger = User::factory()->create();
    $stranger->assignRole('coach');

    $review = acceptedInProgressReview($speaker, $reviewer);

    $response = $this->actingAs($stranger)->postJson("/api/speeches/{$review->speech_id}/annotations", [
        'client_uuid' => (string) Str::uuid(),
        'body' => 'Should never land.',
        'start_seconds' => 1.0,
    ]);

    $response->assertNotFound();
});

it('returns 409 with conflictSource "self" and the current record on a lock_version mismatch', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $annotation = Annotation::factory()->for($review)->draft()->create(['lock_version' => 0, 'body' => 'original']);

    $response = $this->actingAs($reviewer)->patchJson(
        "/api/speeches/{$review->speech_id}/annotations/{$annotation->id}",
        ['lock_version' => 5, 'body' => 'a stale edit']
    );

    $response->assertStatus(409);
    $response->assertJsonPath('conflictSource', 'self');
    $response->assertJsonPath('current.id', (string) $annotation->id);
    $response->assertJsonPath('current.body', 'original');

    expect($annotation->fresh()->body)->toBe('original');
});

it('conflictSource is always the literal string "self" for annotations, never any other value', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $annotation = Annotation::factory()->for($review)->draft()->create(['lock_version' => 3]);

    $response = $this->actingAs($reviewer)->patchJson(
        "/api/speeches/{$review->speech_id}/annotations/{$annotation->id}",
        ['lock_version' => 0, 'body' => 'irrelevant']
    );

    $response->assertStatus(409);
    expect($response->json('conflictSource'))->toBe('self');
});

it('a 409 conflict on a voice annotation still reports its voice field, never null', function () {
    // Code-review finding: AnnotationService::update() re-fetched the
    // conflicting row without eager-loading audioAsset (only the success
    // path did), so AnnotationResource — which keys `voice` off
    // relationLoaded('audioAsset') — rendered `current.voice: null` for a
    // real, live voice annotation on a lock_version conflict.
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $voiceAsset = SpeechAsset::factory()->for($review->speech)->voiceNote()->create(['status' => 'ready']);
    $annotation = Annotation::factory()->for($review)->create([
        'lock_version' => 0,
        'audio_asset_id' => $voiceAsset->id,
        'transcript_status' => 'ready',
        'body' => 'transcribed text',
    ])->refresh();

    $response = $this->actingAs($reviewer)->patchJson(
        "/api/speeches/{$review->speech_id}/annotations/{$annotation->id}",
        ['lock_version' => $annotation->lock_version + 1, 'body' => 'a stale edit']
    );

    $response->assertStatus(409);
    $response->assertJsonPath('current.voice.asset_id', $voiceAsset->id);
});

it('applies the change and increments lock_version on a matching lock_version', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $annotation = Annotation::factory()->for($review)->draft()->create(['lock_version' => 0, 'start_seconds' => 10.0]);

    $response = $this->actingAs($reviewer)->patchJson(
        "/api/speeches/{$review->speech_id}/annotations/{$annotation->id}",
        ['lock_version' => 0, 'start_seconds' => 10.5]
    );

    $response->assertOk();
    $response->assertJsonPath('annotation.lock_version', 1);
    $response->assertJsonPath('annotation.start_seconds', 10.5);
    expect($annotation->fresh()->lock_version)->toBe(1);
});

it('delete-then-recreate with the same client_uuid succeeds as a new live row and does not collide with the tombstone', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $clientUuid = (string) Str::uuid();

    $payload = [
        'client_uuid' => $clientUuid,
        'body' => 'Undo me.',
        'start_seconds' => 3.0,
    ];

    $created = $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/annotations", $payload);
    $created->assertCreated();
    $originalId = $created->json('annotation.id');

    $delete = $this->actingAs($reviewer)->deleteJson("/api/speeches/{$review->speech_id}/annotations/{$originalId}");
    $delete->assertNoContent();
    expect(Annotation::withTrashed()->find($originalId)->deleted_at)->not->toBeNull();

    // The frontend's 6-second Undo: an ordinary re-POST with the identical
    // client_uuid and fields.
    $recreated = $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/annotations", $payload);
    $recreated->assertCreated();
    $newId = $recreated->json('annotation.id');

    expect($newId)->not->toBe($originalId);
    expect(Annotation::where('client_uuid', $clientUuid)->count())->toBe(1); // only the new live row
    expect(Annotation::withTrashed()->where('client_uuid', $clientUuid)->count())->toBe(2); // tombstone + live
});

it('delete decrements annotations_count, and published_annotations_count too when the row was published', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $published = Annotation::factory()->for($review)->create(['published_at' => now()]);
    $review->update(['annotations_count' => 1, 'published_annotations_count' => 1]);

    $this->actingAs($reviewer)->deleteJson("/api/speeches/{$review->speech_id}/annotations/{$published->id}")
        ->assertNoContent();

    $fresh = $review->fresh();
    expect($fresh->annotations_count)->toBe(0);
    expect($fresh->published_annotations_count)->toBe(0);
});

it('a reviewer cannot update or delete another reviewer\'s annotation, even by guessing its id', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewerA] = speakerAndCoach();
    $reviewerB = User::factory()->create();
    $reviewerB->assignRole('coach');

    $reviewA = acceptedInProgressReview($speaker, $reviewerA);
    $reviewB = acceptedInProgressReview($speaker, $reviewerB, Speech::factory()->for($speaker)->create());

    $annotationA = Annotation::factory()->for($reviewA)->draft()->create();

    $this->actingAs($reviewerB)->patchJson(
        "/api/speeches/{$reviewB->speech_id}/annotations/{$annotationA->id}",
        ['lock_version' => 0, 'body' => 'hijacked']
    )->assertNotFound();

    $this->actingAs($reviewerB)->deleteJson("/api/speeches/{$reviewB->speech_id}/annotations/{$annotationA->id}")
        ->assertNotFound();

    expect($annotationA->fresh()->body)->toBe($annotationA->body);
});

it('clearAnnotations empties the set and leaves the review, the access grant and the acceptance record intact', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    Annotation::factory()->for($review)->create(['published_at' => now()]);
    Annotation::factory()->for($review)->draft()->create();
    $review->update(['annotations_count' => 2, 'published_annotations_count' => 1]);
    $respondedAt = $review->responded_at;

    $response = $this->actingAs($reviewer)->deleteJson("/api/speeches/{$review->speech_id}/annotation-sets/me");
    $response->assertNoContent();

    $fresh = $review->fresh();
    expect($fresh->annotations_count)->toBe(0);
    expect($fresh->published_annotations_count)->toBe(0);
    expect($fresh->status)->toBe('in_progress'); // untouched
    expect($fresh->revoked_at)->toBeNull(); // access grant untouched
    expect($fresh->reviewer_id)->toBe($reviewer->id); // access grant untouched
    expect($fresh->responded_at->equalTo($respondedAt))->toBeTrue(); // acceptance record untouched
    expect(Annotation::where('review_id', $review->id)->count())->toBe(0);
    expect(Annotation::withTrashed()->where('review_id', $review->id)->count())->toBe(2);
});

it('a stranger cannot clear a review they don\'t own', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $stranger = User::factory()->create();
    $stranger->assignRole('coach');

    $review = acceptedInProgressReview($speaker, $reviewer);

    $this->actingAs($stranger)->deleteJson("/api/speeches/{$review->speech_id}/annotation-sets/me")
        ->assertNotFound();
});

it('publish publishes only the caller\'s live drafts and returns the delta for this call, zero on a rerun', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    Annotation::factory()->for($review)->draft()->create();
    Annotation::factory()->for($review)->draft()->create();
    Annotation::factory()->for($review)->create(['published_at' => now()->subDay()]); // already published
    $review->update(['annotations_count' => 3, 'published_annotations_count' => 1]);

    $first = $this->actingAs($reviewer)->postJson("/api/reviews/{$review->id}/publish");
    $first->assertOk();
    $first->assertJsonPath('published_count', 2);

    $fresh = $review->fresh();
    expect($fresh->status)->toBe('published');
    expect($fresh->published_annotations_count)->toBe(3);
    expect($fresh->first_published_at)->not->toBeNull();
    expect($fresh->last_published_at)->not->toBeNull();
    expect(Annotation::where('review_id', $review->id)->whereNull('published_at')->count())->toBe(0);

    // Publish-additions re-run: nothing new, must not error, delta is 0.
    $second = $this->actingAs($reviewer)->postJson("/api/reviews/{$review->id}/publish");
    $second->assertOk();
    $second->assertJsonPath('published_count', 0);
});

it('publish-additions: a later draft on an already-published review is picked up on the next publish call', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $review->update(['status' => 'published', 'first_published_at' => now()->subDay(), 'last_published_at' => now()->subDay()]);

    Annotation::factory()->for($review)->draft()->create();
    $review->update(['annotations_count' => 1]);

    $response = $this->actingAs($reviewer)->postJson("/api/reviews/{$review->id}/publish");
    $response->assertOk();
    $response->assertJsonPath('published_count', 1);
});

it('transitions accepted to in_progress on the first annotation only', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedReview($speaker, $reviewer); // status stays 'accepted'
    expect($review->status)->toBe('accepted');

    $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/annotations", [
        'client_uuid' => (string) Str::uuid(),
        'body' => 'First note.',
        'start_seconds' => 1.0,
    ])->assertCreated();

    expect($review->fresh()->status)->toBe('in_progress');

    $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/annotations", [
        'client_uuid' => (string) Str::uuid(),
        'body' => 'Second note.',
        'start_seconds' => 2.0,
    ])->assertCreated();

    // Still in_progress, not bounced back or transitioned again.
    expect($review->fresh()->status)->toBe('in_progress');
});

it('returns 410 Gone (not 404) for a soft-deleted speech, across every annotation route', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $annotation = Annotation::factory()->for($review)->draft()->create();
    $speech = $review->speech;
    $speech->delete();

    $this->actingAs($reviewer)->getJson("/api/speeches/{$speech->id}/annotations?review_id={$review->id}")
        ->assertStatus(410);

    $this->actingAs($reviewer)->postJson("/api/speeches/{$speech->id}/annotations", [
        'client_uuid' => (string) Str::uuid(),
        'body' => 'Too late.',
        'start_seconds' => 1.0,
    ])->assertStatus(410);

    $this->actingAs($reviewer)->patchJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}", [
        'lock_version' => 0,
        'body' => 'Too late.',
    ])->assertStatus(410);

    $this->actingAs($reviewer)->deleteJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}")
        ->assertStatus(410);

    $this->actingAs($reviewer)->deleteJson("/api/speeches/{$speech->id}/annotation-sets/me")
        ->assertStatus(410);
});

it('still returns a plain 404, not 410, for a speech id that never existed at all', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $neverExisted = Speech::query()->max('id') + 1000;

    $this->actingAs($reviewer)->postJson("/api/speeches/{$neverExisted}/annotations", [
        'client_uuid' => (string) Str::uuid(),
        'body' => 'Nowhere.',
        'start_seconds' => 1.0,
    ])->assertNotFound();
});

it('404s an admin write attempt when the admin holds no review at all (the ordinary, expected case)', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $review = acceptedInProgressReview($speaker, $reviewer);
    $annotation = Annotation::factory()->for($review)->draft()->create();

    // The admin holds no review row on this speech, so resolveOwnReview()
    // 404s before authorize() is even reached — indistinguishable to the
    // admin from "no such review", which is correct: §7.1's directory
    // already excludes admins from ever being invited as a reviewer, so
    // this is the ordinary shape the categorical policy check almost never
    // has to run against in practice (the next test forces the contrived
    // case where it does).
    $this->actingAs($admin)->postJson("/api/speeches/{$review->speech_id}/annotations", [
        'client_uuid' => (string) Str::uuid(),
        'body' => 'Admin should never write this.',
        'start_seconds' => 1.0,
    ])->assertNotFound();

    $this->actingAs($admin)->deleteJson("/api/speeches/{$review->speech_id}/annotation-sets/me")
        ->assertNotFound();

    expect(Annotation::where('review_id', $review->id)->count())->toBe(1);
});

/**
 * Defensive coverage for the case §7.1 says should never happen (an admin
 * holding a review row) — mirrors AnnotationEndpointTest's own
 * `readAnnotations` admin-dual-role test, which exercises the same
 * contrived state for the same reason: if this invariant is ever violated
 * by a bug elsewhere, isolation must still win at the policy layer, not
 * merely as a side effect of admins normally having no review row to
 * resolve. Every ability this step adds is asserted directly against the
 * policy classes, which is the only way to prove the categorical
 * `hasRole('admin') => false` check runs BEFORE the ownership check, since
 * `$review->reviewer_id === $admin->id` is forced true here.
 */
it('the categorical "admin never acts as a reviewer" rule holds for every STEP-07 ability even if a review row is forced under an admin id', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $review = acceptedInProgressReview($speaker, $reviewer);
    $review->update(['reviewer_id' => $admin->id]); // forced, contrived
    $annotation = Annotation::factory()->for($review)->draft()->create();

    expect(app(AnnotationPolicy::class)->create($admin, $review->fresh()))->toBeFalse();
    expect(app(AnnotationPolicy::class)->update($admin, $annotation->fresh()))->toBeFalse();
    expect(app(AnnotationPolicy::class)->delete($admin, $annotation->fresh()))->toBeFalse();
    expect(app(ReviewPolicy::class)->publish($admin, $review->fresh()))->toBeFalse();
    expect(app(ReviewPolicy::class)->clearAnnotations($admin, $review->fresh()))->toBeFalse();

    $this->actingAs($admin)->postJson("/api/speeches/{$review->speech_id}/annotations", [
        'client_uuid' => (string) Str::uuid(),
        'body' => 'Admin should never write this.',
        'start_seconds' => 1.0,
    ])->assertForbidden();

    $this->actingAs($admin)->patchJson(
        "/api/speeches/{$review->speech_id}/annotations/{$annotation->id}",
        ['lock_version' => 0, 'body' => 'admin edit']
    )->assertForbidden();

    $this->actingAs($admin)->deleteJson("/api/speeches/{$review->speech_id}/annotations/{$annotation->id}")
        ->assertForbidden();

    $this->actingAs($admin)->deleteJson("/api/speeches/{$review->speech_id}/annotation-sets/me")
        ->assertForbidden();

    $this->actingAs($admin)->postJson("/api/reviews/{$review->id}/publish")
        ->assertForbidden();

    // Confirm none of this silently no-op'd instead of 403ing.
    expect(Annotation::where('review_id', $review->id)->count())->toBe(1);
});

it('a revoked reviewer can no longer write annotations even though status still reads in_progress', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, $reviewer] = speakerAndCoach();
    $review = acceptedInProgressReview($speaker, $reviewer);
    $review->update(['revoked_at' => now()]);

    $this->actingAs($reviewer)->postJson("/api/speeches/{$review->speech_id}/annotations", [
        'client_uuid' => (string) Str::uuid(),
        'body' => 'Should be refused.',
        'start_seconds' => 1.0,
    ])->assertForbidden();
});
