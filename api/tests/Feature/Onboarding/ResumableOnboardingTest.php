<?php

use App\Models\User;

/**
 * Resumability is a real requirement, not a nicety (§6.5): each step writes
 * straight to `users`/`profiles`, so a user who quits after step 2 and
 * returns tomorrow (a fresh request, possibly a fresh session — modeled
 * here by re-fetching the user from the database rather than trusting any
 * in-memory state) resumes at step 2, not step 1.
 */
it('starts a fresh user at onboarding step 1', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->getJson('/api/onboarding');

    $response->assertOk();
    $response->assertJsonPath('step', 1);
});

it('resumes at step 2 after step 1 is completed and the user returns later', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->postJson('/api/onboarding/step-1', [
        'first_name' => 'Ada',
        'last_name' => 'Lovelace',
        'username' => 'ada-lovelace',
    ])->assertOk();

    // "Returns tomorrow": a brand new request against the same user row,
    // nothing carried over except what's in the database.
    $fresh = User::query()->find($user->id);
    $response = $this->actingAs($fresh)->getJson('/api/onboarding');

    $response->assertOk();
    $response->assertJsonPath('step', 2);
});

it('resumes at step 3 after step 2, and completes onboarding at step 3', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->postJson('/api/onboarding/step-1', [
        'first_name' => 'Ada',
        'last_name' => 'Lovelace',
        'username' => 'ada-lovelace-2',
    ])->assertOk();

    $this->actingAs($user)->postJson('/api/onboarding/step-2', [
        'bio' => 'I write the first algorithm.',
    ])->assertOk();

    $fresh = User::query()->find($user->id);
    $this->actingAs($fresh)->getJson('/api/onboarding')->assertJsonPath('step', 3);

    $this->actingAs($fresh)->postJson('/api/onboarding/step-3', [])->assertOk();

    $completed = User::query()->find($user->id);
    expect($completed->profile->onboarding_completed_at)->not->toBeNull();

    $this->actingAs($completed)->getJson('/api/onboarding')->assertJsonPath('step', 4);
});

it('allows skipping bio/pronouns/location and avatar entirely and still completing onboarding', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->postJson('/api/onboarding/step-1', [
        'first_name' => 'Skip',
        'last_name' => 'Peterson',
        'username' => 'skip-p',
    ])->assertOk();

    $this->actingAs($user)->postJson('/api/onboarding/step-2', [])->assertOk();
    $this->actingAs($user)->postJson('/api/onboarding/step-3', [])->assertOk();

    expect($user->fresh('profile')->profile->onboarding_completed_at)->not->toBeNull();
});
