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
