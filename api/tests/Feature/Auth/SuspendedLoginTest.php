<?php

use App\Models\User;

/**
 * code-review finding (2026-10-10), surfaced while implementing
 * PLAN-ADMIN-LOGIN-REDIRECT.md's Phase 2: before `FortifyServiceProvider`
 * registered `Fortify::authenticateUsing()`, a suspended/deleted/anonymized
 * account's password still succeeded at `POST /login` — `CheckUserIsActive`
 * only evicts on the NEXT authenticated request, since `$request->user()`
 * resolves `null` during the login request itself. That meant
 * `LoginResponse` returned 200 with `roles` in the body for an account
 * that was about to be evicted, which Phase 2's `getPostLoginDestination()`
 * then reads to decide where to send the browser.
 */
it('rejects a suspended user at the credential check, not just on the next request', function () {
    $password = 'correct-horse-battery-staple';
    $user = User::factory()->create(['password' => bcrypt($password), 'suspended_at' => now()]);

    $this->postJson('/login', [
        'email' => $user->email,
        'password' => $password,
    ])->assertUnprocessable();

    $this->assertGuest();
});

it('rejects a soft-deleted user the same way', function () {
    $password = 'correct-horse-battery-staple';
    $user = User::factory()->create(['password' => bcrypt($password), 'deleted_at' => now()]);

    $this->postJson('/login', ['email' => $user->email, 'password' => $password])
        ->assertUnprocessable();

    $this->assertGuest();
});

it('rejects an anonymized user the same way', function () {
    $password = 'correct-horse-battery-staple';
    $user = User::factory()->create(['password' => bcrypt($password), 'anonymized_at' => now()]);

    $this->postJson('/login', ['email' => $user->email, 'password' => $password])
        ->assertUnprocessable();

    $this->assertGuest();
});

it('still lets an ordinary active user log in', function () {
    $password = 'correct-horse-battery-staple';
    $user = User::factory()->create(['password' => bcrypt($password)]);

    $this->postJson('/login', ['email' => $user->email, 'password' => $password])
        ->assertOk();

    $this->assertAuthenticatedAs($user);
});

it('rejects a wrong password exactly as before — the guard does not weaken ordinary credential checking', function () {
    $user = User::factory()->create(['password' => bcrypt('correct-horse-battery-staple')]);

    $this->postJson('/login', ['email' => $user->email, 'password' => 'wrong'])
        ->assertUnprocessable();

    $this->assertGuest();
});
