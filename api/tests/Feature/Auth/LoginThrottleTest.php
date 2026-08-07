<?php

use App\Models\User;

/**
 * config/fortify.php's stub for the Fortify version installed here ships
 * `'limiters' => ['login' => 'login']` pre-filled, but STEP-01-identity.md
 * calls out that an earlier Fortify release shipped `'login' => null`,
 * which makes the RateLimiter::for('login', ...) definition in
 * FortifyServiceProvider completely inert — the throttle middleware is
 * never attached to the route at all in that case, so no number of
 * requests would ever 429. Asserting the actual HTTP behavior (not just
 * reading the config value) is what catches that regression if it ever
 * comes back.
 */
it('throttles repeated failed logins to a 429', function () {
    User::factory()->create(['email' => 'victim@example.com']);

    for ($i = 0; $i < 5; $i++) {
        $this->postJson('/login', [
            'email' => 'victim@example.com',
            'password' => 'wrong-password',
        ])->assertStatus(422);
    }

    $this->postJson('/login', [
        'email' => 'victim@example.com',
        'password' => 'wrong-password',
    ])->assertStatus(429);
});

it('has the login rate limiter explicitly configured, not the inert null default', function () {
    expect(config('fortify.limiters.login'))->toBe('login');
});
