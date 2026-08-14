<?php

use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Policies\AnnotationPolicy;
use Database\Seeders\RoleSeeder;

/**
 * STEP-06-watch-commentary.md / MODERNIZATION_PLAN §7.3, §8.5. HTTP-level
 * coverage of `GET /speeches/{speech}/annotations?review_id=` against the
 * frozen backend/frontend contract.
 */
function makeAcceptedReview(User $speaker, User $reviewer, ?Speech $speech = null): Review
{
    $speech ??= Speech::factory()->for($speaker)->create();

    return Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $speaker->id,
    ]);
}

it('never shows the speaker a draft written after publication', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');

    $review = makeAcceptedReview($speaker, $reviewer);
    $review->update(['status' => 'published', 'first_published_at' => now(), 'last_published_at' => now()]);

    $published = Annotation::factory()->for($review)->create([
        'body' => 'Published before the speaker looked.',
        'start_seconds' => 10.0,
        'published_at' => now()->subDay(),
    ]);

    // The draft below is created strictly AFTER the published row above —
    // "a draft written after publication" per the acceptance criterion.
    $draftAfterPublish = Annotation::factory()->for($review)->draft()->create([
        'body' => 'A late-breaking thought the coach has not published yet.',
        'start_seconds' => 20.0,
    ]);

    $response = $this->actingAs($speaker)->getJson("/api/speeches/{$review->speech_id}/annotations?review_id={$review->id}");

    $response->assertOk();
    $bodies = collect($response->json('annotations'))->pluck('body')->all();

    expect($bodies)->toContain('Published before the speaker looked.');
    expect($bodies)->not->toContain('A late-breaking thought the coach has not published yet.');
    expect(collect($response->json('annotations'))->pluck('id')->all())
        ->not->toContain((string) $draftAfterPublish->id);
});

it('lets the author see every row, including drafts, but denies a revoked author entirely (tombstone)', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');

    $review = makeAcceptedReview($speaker, $reviewer);
    Annotation::factory()->for($review)->create(['start_seconds' => 5.0]);
    Annotation::factory()->for($review)->draft()->create(['start_seconds' => 6.0]);

    $asAuthor = $this->actingAs($reviewer)->getJson("/api/speeches/{$review->speech_id}/annotations?review_id={$review->id}");
    $asAuthor->assertOk();
    expect(count($asAuthor->json('annotations')))->toBe(2);

    // Revoke, then the author gets nothing through this endpoint — a
    // read-only tombstone is a separate, narrower ability this endpoint
    // does not implement.
    $review->update(['revoked_at' => now()]);

    $asRevokedAuthor = $this->actingAs($reviewer)->getJson("/api/speeches/{$review->speech_id}/annotations?review_id={$review->id}");
    $asRevokedAuthor->assertForbidden();
});

it('lets an admin read unconditionally and never trips the dual-role assert for a clean review', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $review = makeAcceptedReview($speaker, $reviewer);
    Annotation::factory()->for($review)->create(['start_seconds' => 1.0]);
    Annotation::factory()->for($review)->draft()->create(['start_seconds' => 2.0]);

    $response = $this->actingAs($admin)->getJson("/api/speeches/{$review->speech_id}/annotations?review_id={$review->id}");

    $response->assertOk();
    expect(count($response->json('annotations')))->toBe(2);

    // Directly exercise the policy method (mirrors ReviewInvitationHttpTest's
    // pattern of confirming the categorical rule isn't merely Gate::before's
    // bypass) — this also runs the defensive assert() with no dual role
    // present, which must not throw.
    expect(app(AnnotationPolicy::class)->readAnnotations($admin, $review->fresh()))->toBeTrue();
});

it('returns 404 when review_id belongs to a different speech', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');

    $speechA = Speech::factory()->for($speaker)->create();
    $speechB = Speech::factory()->for($speaker)->create();
    $review = makeAcceptedReview($speaker, $reviewer, $speechB);

    $response = $this->actingAs($speaker)->getJson("/api/speeches/{$speechA->id}/annotations?review_id={$review->id}");

    $response->assertNotFound();
});

it('returns 422 when review_id is missing', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();

    $response = $this->actingAs($speaker)->getJson("/api/speeches/{$speech->id}/annotations");

    $response->assertStatus(422);
});

it('orders annotations by start_seconds then id', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');

    $review = makeAcceptedReview($speaker, $reviewer);

    $second = Annotation::factory()->for($review)->create(['start_seconds' => 62.000, 'body' => 'second']);
    $first = Annotation::factory()->for($review)->create(['start_seconds' => 14.000, 'body' => 'first']);
    // Same start_seconds as $second — id must break the tie.
    $tieBreak = Annotation::factory()->for($review)->create(['start_seconds' => 62.000, 'body' => 'tie-break']);

    $response = $this->actingAs($reviewer)->getJson("/api/speeches/{$review->speech_id}/annotations?review_id={$review->id}");

    $response->assertOk();
    $ids = collect($response->json('annotations'))->pluck('id')->all();

    expect($ids)->toBe([
        (string) $first->id,
        (string) $second->id,
        (string) $tieBreak->id,
    ]);
});

it('returns 200 with an empty array, never 404, when a review has no annotations', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('coach');

    $review = makeAcceptedReview($speaker, $reviewer);

    $response = $this->actingAs($reviewer)->getJson("/api/speeches/{$review->speech_id}/annotations?review_id={$review->id}");

    $response->assertOk();
    expect($response->json('annotations'))->toBe([]);
});

it('matches the frozen contract\'s response shape exactly', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create(['first_name' => 'Jane', 'last_name' => 'Coach']);
    $reviewer->assignRole('coach');

    $review = makeAcceptedReview($speaker, $reviewer);
    $annotation = Annotation::factory()->for($review)->create([
        'start_seconds' => 14.0,
        'duration_seconds' => 6.0,
        'kind' => 'praise',
        'topic' => 'pacing',
        'body' => 'Great pacing here.',
    ]);

    $response = $this->actingAs($reviewer)->getJson("/api/speeches/{$review->speech_id}/annotations?review_id={$review->id}");

    $response->assertOk();
    $response->assertJson([
        'review_id' => $review->id,
        'reviewer' => ['id' => $reviewer->id, 'name' => 'Jane Coach'],
        'annotations' => [[
            'id' => (string) $annotation->id,
            'start_seconds' => 14.0,
            'duration_seconds' => 6.0,
            'kind' => 'praise',
            'topic' => 'pacing',
            'body' => 'Great pacing here.',
        ]],
    ]);
    expect($response->json('annotations.0.id'))->toBeString();
});
