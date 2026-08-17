<?php

use App\Models\User;
use Database\Seeders\RoleSeeder;

/**
 * PLAN-APP-HEADER.md Backend item 4: `GET /api/me` had zero test coverage
 * before this — grep of tests/ for "api/me" returned nothing. This is the
 * single most important endpoint for the header (every route guard reads
 * it), so the field-by-field contract and the mid-onboarding null/empty
 * case are asserted directly here rather than left to be exercised
 * incidentally by other features' tests.
 */
it('returns the full /api/me contract for a fully onboarded user', function () {
    $this->seed(RoleSeeder::class);

    $user = User::factory()->create([
        'first_name' => 'Mars',
        'last_name' => 'Cheung',
        'username' => 'mars',
        'email' => 'mars@example.com',
    ]);
    $user->assignRole('member');
    // Every User already has an empty `profiles` row via User::booted()
    // (firstOrCreate on the `created` event) — update it rather than
    // creating a second one.
    $user->profile->update([
        'display_name' => null,
        'onboarding_completed_at' => now(),
    ]);

    $response = $this->actingAs($user)->getJson('/api/me');

    $response->assertOk();
    $response->assertJson([
        'user' => [
            'id' => (string) $user->id,
            'email' => 'mars@example.com',
            'first_name' => 'Mars',
            'last_name' => 'Cheung',
            'username' => 'mars',
            // No profile.display_name set, so the trimmed first+last fallback.
            'display_name' => 'Mars Cheung',
            'email_verified' => true,
            'roles' => ['member'],
            'onboarding_completed' => true,
        ],
    ]);
    // `id` must be a JSON string, not a number — types.ts declares `string`
    // and the resource casts to match it (PLAN-APP-HEADER.md Backend
    // item 3).
    expect($response->json('user.id'))->toBeString();
});

it('prefers profile.display_name over the first/last fallback, matching PublicProfileResource', function () {
    $user = User::factory()->create([
        'first_name' => 'Mars',
        'last_name' => 'Cheung',
    ]);
    $user->profile->update(['display_name' => 'Marsy']);

    $response = $this->actingAs($user)->getJson('/api/me');

    $response->assertOk();
    $response->assertJsonPath('user.display_name', 'Marsy');
});

it('returns the mid-onboarding contract: null names/username and an empty roles array', function () {
    $this->seed(RoleSeeder::class);

    // Deliberately no assignRole() call — P1: registration assigns no
    // role, so roles: [] is the normal case for every real user, not an
    // edge case (S3).
    $user = User::factory()->create([
        'first_name' => null,
        'last_name' => null,
        'username' => null,
    ]);

    $response = $this->actingAs($user)->getJson('/api/me');

    $response->assertOk();
    $response->assertJson([
        'user' => [
            'id' => (string) $user->id,
            'first_name' => null,
            'last_name' => null,
            'username' => null,
            // No profile row at all: display_name falls back to
            // trim("{$first_name} {$last_name}") with both null, which
            // is trim(" ") === "".
            'display_name' => '',
            'roles' => [],
            'onboarding_completed' => false,
        ],
    ]);
});

it('returns 401 for an unauthenticated GET /api/me', function () {
    $response = $this->getJson('/api/me');

    $response->assertStatus(401);
    $response->assertJson(['message' => 'Unauthenticated.']);
});
