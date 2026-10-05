<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Database\Seeders\E2ESeeder;

/**
 * The CP-05 (two-users-one-test) fixture, and the exact HTTP status codes
 * the Playwright spec `web/tests/two-users.spec.ts` asserts against it.
 *
 * Pinning the codes here matters: a Playwright run needs the whole Docker
 * stack up and the seeder applied, so a wrong expectation there costs
 * minutes to discover. Here it costs seconds, and it keeps the E2E spec
 * honest if a policy ever changes underneath it.
 */
it('seeds one speech with two accepted reviews by two different coaches', function () {
    $this->seed(E2ESeeder::class);

    $coachB = User::query()->find(E2ESeeder::COACH_B_ID);
    expect($coachB)->not->toBeNull();
    expect($coachB->hasRole('coach'))->toBeTrue();
    expect($coachB->email)->toBe('coach-b@e2e.test');
    expect($coachB->profile->onboarding_completed_at)->not->toBeNull();

    // The pre-existing coach must still hold exactly 'coach' — the slug
    // 'coach_b' is a fixture slug, never a role.
    expect(User::query()->find(E2ESeeder::COACH_ID)->hasRole('coach'))->toBeTrue();

    $speech = Speech::query()->find(E2ESeeder::SHARED_SPEECH_ID);
    expect($speech)->not->toBeNull();
    expect($speech->user_id)->toBe(E2ESeeder::MEMBER_ID);

    foreach ([
        E2ESeeder::REVIEW_COACH_A_ID => E2ESeeder::COACH_ID,
        E2ESeeder::REVIEW_COACH_B_ID => E2ESeeder::COACH_B_ID,
    ] as $reviewId => $reviewerId) {
        $review = Review::query()->find($reviewId);
        expect($review)->not->toBeNull();
        expect($review->speech_id)->toBe(E2ESeeder::SHARED_SPEECH_ID);
        expect($review->reviewer_id)->toBe($reviewerId);
        expect($review->status)->toBe('accepted');
        expect($review->revoked_at)->toBeNull();
    }
});

it('is idempotent, so re-seeding a live e2e database does not duplicate the fixture', function () {
    $this->seed(E2ESeeder::class);
    $this->seed(E2ESeeder::class);

    expect(Speech::query()->where('id', E2ESeeder::SHARED_SPEECH_ID)->count())->toBe(1);
    expect(Review::query()->whereIn('id', [E2ESeeder::REVIEW_COACH_A_ID, E2ESeeder::REVIEW_COACH_B_ID])->count())->toBe(2);
    expect(User::query()->where('email', 'coach-b@e2e.test')->count())->toBe(1);
});

it('pins the status codes two-users.spec.ts asserts for reviewer isolation', function () {
    $this->seed(E2ESeeder::class);

    $coachA = User::query()->find(E2ESeeder::COACH_ID);
    $speechId = E2ESeeder::SHARED_SPEECH_ID;

    // Reviewer A reading their OWN commentary: 200.
    $this->actingAs($coachA)
        ->getJson("/api/speeches/{$speechId}/annotations?review_id=".E2ESeeder::REVIEW_COACH_A_ID)
        ->assertOk();

    // Reviewer A reading reviewer B's commentary: 403. This is the whole
    // requirement — §7.3's "the requirement" branch returning false.
    $this->actingAs($coachA)
        ->getJson("/api/speeches/{$speechId}/annotations?review_id=".E2ESeeder::REVIEW_COACH_B_ID)
        ->assertForbidden();

    // The reviewer roster is owner-only, and denial is disguised as 404
    // rather than 403 (a 403 would itself confirm the speech exists).
    $this->actingAs($coachA)
        ->getJson("/api/speeches/{$speechId}/reviews")
        ->assertNotFound();

    // The speaker, by contrast, sees both reviewers — the assertion that
    // keeps the leak checks above from passing vacuously.
    $speaker = User::query()->find(E2ESeeder::MEMBER_ID);
    $roster = $this->actingAs($speaker)->getJson("/api/speeches/{$speechId}/reviews");
    $roster->assertOk();
    expect(collect($roster->json('reviews'))->pluck('reviewer.id')->sort()->values()->all())
        ->toBe([E2ESeeder::COACH_ID, E2ESeeder::COACH_B_ID]);
});

/**
 * PLAN-ACCESS-DENIED-STATES.md §5.3. The 403 branch added to
 * SpeechController::show had no reachable fixture — the database contained
 * zero revoked reviews — so neither a browser session nor a Playwright spec
 * could exercise it. Coach C exists for that, and this pins both halves:
 * the tombstone is seeded, and it stays invisible to the speaker's roster.
 */
it('seeds a third coach whose review is revoked, so the access-denied branch is reachable', function () {
    $this->seed(E2ESeeder::class);

    $coachC = User::query()->find(E2ESeeder::COACH_C_ID);
    expect($coachC)->not->toBeNull();
    expect($coachC->email)->toBe('coach-c@e2e.test');
    expect($coachC->hasRole('coach'))->toBeTrue();
    expect($coachC->profile->onboarding_completed_at)->not->toBeNull();

    $revoked = Review::query()->find(E2ESeeder::REVIEW_COACH_C_REVOKED_ID);
    expect($revoked)->not->toBeNull();
    expect($revoked->speech_id)->toBe(E2ESeeder::SHARED_SPEECH_ID);
    expect($revoked->reviewer_id)->toBe(E2ESeeder::COACH_C_ID);
    expect($revoked->revoked_at)->not->toBeNull();
    expect($revoked->revoked_by_id)->toBe(E2ESeeder::MEMBER_ID);
    // Orthogonal to status, exactly as ReviewService::revoke leaves it.
    expect($revoked->status)->toBe('accepted');

    // The branch this fixture exists to reach.
    $response = $this->actingAs($coachC)->getJson('/api/speeches/'.E2ESeeder::SHARED_SPEECH_ID);
    $response->assertForbidden();
    expect($response->json('code'))->toBe('speech_access_denied');
    expect(strtolower($response->getContent()))->not->toContain('revok');
});

it('keeps the revoked third review out of the speaker roster and out of the other coaches\' way', function () {
    $this->seed(E2ESeeder::class);

    // The speaker's roster is still exactly the two live reviewers — the
    // assertion the isolation specs depend on. `forSpeech` filters both
    // ACCESS_GRANTING and `revoked_at IS NULL`, which is what makes adding
    // a revoked row safe here.
    $speaker = User::query()->find(E2ESeeder::MEMBER_ID);
    $roster = $this->actingAs($speaker)->getJson('/api/speeches/'.E2ESeeder::SHARED_SPEECH_ID.'/reviews');
    $roster->assertOk();
    expect(collect($roster->json('reviews'))->pluck('reviewer.id')->sort()->values()->all())
        ->toBe([E2ESeeder::COACH_ID, E2ESeeder::COACH_B_ID]);

    // And the two live coaches are untouched by the new row.
    foreach ([E2ESeeder::REVIEW_COACH_A_ID, E2ESeeder::REVIEW_COACH_B_ID] as $reviewId) {
        expect(Review::query()->find($reviewId)->revoked_at)->toBeNull();
    }
});

it('re-seeds the revoked fixture idempotently, and a spec revoking a live review cannot make that permanent', function () {
    $this->seed(E2ESeeder::class);

    // Simulate a spec revoking coach A mid-run.
    Review::query()->whereKey(E2ESeeder::REVIEW_COACH_A_ID)->update([
        'revoked_at' => now(),
        'revocation_reason' => 'Left behind by a test run.',
    ]);

    $this->seed(E2ESeeder::class);

    // Re-seeding must reset it — this is why revocationColumnsFor writes
    // the nulls explicitly for A and B instead of omitting them.
    $coachA = Review::query()->find(E2ESeeder::REVIEW_COACH_A_ID);
    expect($coachA->revoked_at)->toBeNull();
    expect($coachA->revocation_reason)->toBeNull();

    expect(Review::query()->where('speech_id', E2ESeeder::SHARED_SPEECH_ID)->count())->toBe(3);
    expect(User::query()->where('email', 'coach-c@e2e.test')->count())->toBe(1);
});
