<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use App\Policies\ReviewPolicy;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Route;

/**
 * HTTP-level smoke coverage: invite -> accept, the reduced metadata tier
 * before acceptance, the granting-tier full payload after, and the two
 * negative assertions the plan calls out explicitly (no "reviewable
 * speeches" route exists anywhere, and an Admin cannot accept).
 */
it('walks a speech through invite -> reduced metadata -> accept -> full visibility', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create(['title' => 'My Speech']);

    $invite = $this->actingAs($speaker)->postJson("/api/speeches/{$speech->id}/reviews", [
        'reviewer_id' => $reviewer->id,
        'message' => 'Would love your notes',
    ]);
    $invite->assertCreated();
    $reviewId = $invite->json('review.id');

    // Before acceptance: reduced metadata tier, no playback URL field.
    $preAccept = $this->actingAs($reviewer)->getJson("/api/speeches/{$speech->id}");
    $preAccept->assertOk();
    expect($preAccept->json('speech.title'))->toBe('My Speech');
    expect($preAccept->json('speech.invitation_message'))->toBe('Would love your notes');
    expect($preAccept->json('speech.primary_video'))->toBeNull();

    $this->actingAs($reviewer)->postJson("/api/reviews/{$reviewId}/accept")->assertOk();

    $postAccept = $this->actingAs($reviewer)->getJson("/api/speeches/{$speech->id}");
    $postAccept->assertOk();
    expect($postAccept->json('speech.id'))->toBe($speech->id);
});

it('refuses a stranger with 404, not 403, and confirms no reviewable-speeches route exists anywhere', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $stranger = User::factory()->create();
    $stranger->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();

    $this->actingAs($stranger)->getJson("/api/speeches/{$speech->id}")->assertNotFound();

    foreach (Route::getRoutes() as $route) {
        expect($route->uri())->not->toContain('reviewable');
    }
});

it('refuses an admin accepting an invitation by direct API call', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $review = Review::factory()->create([
        'speech_id' => Speech::factory()->for($speaker)->create()->id,
        'reviewer_id' => $admin->id,
        'speech_owner_id' => $speaker->id,
        'status' => 'invited',
    ]);

    $this->actingAs($admin)->postJson("/api/reviews/{$review->id}/accept")->assertForbidden();
});

it('surfaces self-invitation refusal as a 422 over HTTP (the service throw is the real enforcement, this just confirms it renders correctly)', function () {
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();

    $response = $this->actingAs($speaker)->postJson("/api/speeches/{$speech->id}/reviews", [
        'reviewer_id' => $speaker->id,
    ]);

    $response->assertStatus(422);
    expect(Review::query()->where('speech_id', $speech->id)->count())->toBe(0);
});

it('lets a Member invite two Coaches and one other Member by name, all three accept, and the track selector offers all three', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create(['title' => 'My Speech']);

    $coachOne = User::factory()->create();
    $coachOne->assignRole('coach');
    $coachTwo = User::factory()->create();
    $coachTwo->assignRole('coach');
    $peerMember = User::factory()->create();
    $peerMember->assignRole('member');

    $reviewers = [$coachOne, $coachTwo, $peerMember];
    $reviewIds = [];

    foreach ($reviewers as $reviewer) {
        $invite = $this->actingAs($speaker)->postJson("/api/speeches/{$speech->id}/reviews", [
            'reviewer_id' => $reviewer->id,
            'message' => 'Please take a look',
        ]);
        $invite->assertCreated();
        $reviewIds[$reviewer->id] = $invite->json('review.id');
    }

    foreach ($reviewers as $reviewer) {
        $this->actingAs($reviewer)->postJson("/api/reviews/{$reviewIds[$reviewer->id]}/accept")->assertOk();
    }

    $selector = $this->actingAs($speaker)->getJson("/api/speeches/{$speech->id}/reviews");
    $selector->assertOk();

    $returnedIds = collect($selector->json('reviews'))->pluck('reviewer.id')->all();
    $returnedNames = collect($selector->json('reviews'))->pluck('reviewer.name')->all();

    foreach ($reviewers as $reviewer) {
        expect($returnedIds)->toContain($reviewer->id);
        expect($returnedNames)->toContain(trim("{$reviewer->first_name} {$reviewer->last_name}"));
    }

    foreach ($selector->json('reviews') as $row) {
        expect(in_array($row['status'], Review::ACCESS_GRANTING, true))->toBeTrue();
    }

    expect(count($selector->json('reviews')))->toBe(3);
});

it('does not let Reviewer A read Reviewer B\'s review or learn that B exists', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();

    $reviewerA = User::factory()->create(['first_name' => 'Ayana']);
    $reviewerA->assignRole('member');
    $reviewerB = User::factory()->create(['first_name' => 'Bianca']);
    $reviewerB->assignRole('coach');

    $inviteA = $this->actingAs($speaker)->postJson("/api/speeches/{$speech->id}/reviews", [
        'reviewer_id' => $reviewerA->id,
    ])->assertCreated();
    $inviteB = $this->actingAs($speaker)->postJson("/api/speeches/{$speech->id}/reviews", [
        'reviewer_id' => $reviewerB->id,
    ])->assertCreated();

    $reviewIdA = $inviteA->json('review.id');
    $reviewIdB = $inviteB->json('review.id');

    $this->actingAs($reviewerA)->postJson("/api/reviews/{$reviewIdA}/accept")->assertOk();
    $this->actingAs($reviewerB)->postJson("/api/reviews/{$reviewIdB}/accept")->assertOk();

    // A is not the speech owner, so the track-selector endpoint 404s for A
    // rather than leaking the owner's reviewer list (which would include B).
    $asA = $this->actingAs($reviewerA)->getJson("/api/speeches/{$speech->id}/reviews");
    expect($asA->status())->toBeIn([403, 404]);
    expect($asA->getContent())->not->toContain('Bianca');
    expect($asA->getContent())->not->toContain((string) $reviewerB->id);
    expect($asA->getContent())->not->toContain((string) $reviewIdB);

    // No route exists that accepts a bare review id and returns it to
    // anyone other than the owner acting on their own review's verbs — the
    // only review-scoped GET-like surfaces are action endpoints (accept/
    // decline/withdraw/etc.), each policy-gated to `reviewer_id === $user->id`.
    // Confirm B's review-scoped actions are refused for A.
    $this->actingAs($reviewerA)->postJson("/api/reviews/{$reviewIdB}/decline")->assertForbidden();
    $this->actingAs($reviewerA)->postJson("/api/reviews/{$reviewIdB}/withdraw")->assertForbidden();

    // A's own dashboard (`GET /reviews`) must not include B's row either.
    $dashboard = $this->actingAs($reviewerA)->getJson('/api/reviews');
    $dashboard->assertOk();
    expect($dashboard->getContent())->not->toContain('Bianca');
    $dashboardIds = collect($dashboard->json())
        ->flatten(1)
        ->pluck('id')
        ->all();
    expect($dashboardIds)->not->toContain($reviewIdB);
});

it('walks every registered route and asserts none expose a reviewable-speeches listing', function () {
    $suspiciousFragments = ['reviewable', 'review-pool', 'reviews-available', 'open-pool'];

    foreach (Route::getRoutes() as $route) {
        $uri = strtolower($route->uri());
        $name = strtolower((string) $route->getName());

        foreach ($suspiciousFragments as $fragment) {
            expect($uri)->not->toContain($fragment);
            expect($name)->not->toContain($fragment);
        }
    }

    // Positive control: the only reviewer-discovery route registered is the
    // directory (`/reviewers`), a search-by-person endpoint, never a
    // search-by-speech one.
    $reviewRelatedGetRoutes = collect(Route::getRoutes())
        ->filter(fn ($route) => in_array('GET', $route->methods(), true))
        ->filter(fn ($route) => str_contains($route->uri(), 'review'))
        ->map(fn ($route) => $route->uri())
        ->values()
        ->all();

    expect($reviewRelatedGetRoutes)->toContain('api/reviewers');
    expect($reviewRelatedGetRoutes)->toContain('api/reviews');
    expect($reviewRelatedGetRoutes)->toContain('api/speeches/{speech}/reviews');

    foreach ($reviewRelatedGetRoutes as $uri) {
        // None of the review-related GET routes are a bare "list of
        // speeches available to review" — every one is scoped to either
        // the authenticated reviewer's own rows, a specific speech's
        // owner-only rollup, or the person directory.
        expect($uri)->not->toBe('api/speeches/reviewable');
        expect($uri)->not->toBe('api/speeches');
    }
});

it('lets an admin who somehow holds a review row still be denied acceptance categorically', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $admin = User::factory()->create();
    $admin->assignRole('admin');

    $speech = Speech::factory()->for($speaker)->create();

    // Constructed directly, bypassing ReviewService::invite, because in the
    // normal product flow an admin should never end up with a review row —
    // this isolates the policy's categorical denial from the invite path.
    $review = Review::factory()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $admin->id,
        'speech_owner_id' => $speaker->id,
        'status' => 'invited',
    ]);

    $response = $this->actingAs($admin)->postJson("/api/reviews/{$review->id}/accept");
    $response->assertForbidden();

    expect($review->fresh()->status)->toBe('invited');

    // Confirm this isn't merely Gate::before's admin bypass being absent —
    // it's the categorical denial inside ReviewPolicy::accept itself.
    expect(app(ReviewPolicy::class)->accept($admin, $review->fresh()))->toBeFalse();
});

it('accepts a Member reviewer (not just Coaches) through the full HTTP path, proving no hasRole("coach") gate excludes Members', function () {
    Notification::fake();
    $this->seed(RoleSeeder::class);

    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $peerMember = User::factory()->create();
    $peerMember->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();

    $invite = $this->actingAs($speaker)->postJson("/api/speeches/{$speech->id}/reviews", [
        'reviewer_id' => $peerMember->id,
    ]);
    $invite->assertCreated();
    $reviewId = $invite->json('review.id');

    $accept = $this->actingAs($peerMember)->postJson("/api/reviews/{$reviewId}/accept");
    $accept->assertOk();
    expect($accept->json('review.status'))->toBe('accepted');

    $selector = $this->actingAs($speaker)->getJson("/api/speeches/{$speech->id}/reviews");
    $selector->assertOk();
    expect(collect($selector->json('reviews'))->pluck('reviewer.id')->all())->toContain($peerMember->id);
});
