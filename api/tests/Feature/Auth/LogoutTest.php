<?php

use App\Models\User;

/**
 * PLAN-APP-HEADER.md D4/Backend item 4: logout was covered only by a bare
 * assertOk() in E2ESeederRolesTest, and nothing in the suite asserted the
 * already-logged-out 401 case — the outcome the frontend's three-way
 * branch (D4) depends on to avoid bouncing a user into /onboarding after a
 * failed logout.
 */
it('logs out an authenticated user with 200 and the standard message', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->postJson('/logout');

    $response->assertOk();
    $response->assertJson(['message' => 'Logged out.']);
});

it('returns 401 when logging out a session that is already logged out', function () {
    // No ->actingAs() — the route carries Authenticate:web, so a request
    // with no active session 401s rather than 200ing a no-op logout. This
    // is the D4 "already logged out" branch: a double-click, or a session
    // that died in another tab.
    $response = $this->postJson('/logout');

    $response->assertStatus(401);
});
