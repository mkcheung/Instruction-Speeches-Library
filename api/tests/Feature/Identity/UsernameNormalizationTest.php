<?php

use App\Models\User;
use App\Support\Username;
use Database\Seeders\ReservedUsernameSeeder;

/**
 * The Postgres trap (STEP-01-identity.md "Watch for"): Postgres is
 * case-sensitive by default, unlike the MySQL collation
 * (utf8mb4_0900_ai_ci) the plan originally assumed, so `MarsCheung`,
 * `marscheung` and `märscheung` would NOT collide on a plain UNIQUE index
 * here. App\Support\Username::normalize() (case-fold + ASCII
 * transliteration) is what makes them collide instead, applied both by the
 * validation rule and by User's username mutator, so what is compared and
 * what is stored can never drift.
 */
it('normalizes case and accent variants to the same value', function () {
    expect(Username::normalize('MarsCheung'))->toBe('marscheung');
    expect(Username::normalize('märscheung'))->toBe('marscheung');
    expect(Username::normalize('MÄRSCHEUNG'))->toBe('marscheung');
});

it('refuses a second registration of a case/accent variant of an existing username, with a usable message, not a 500', function () {
    $existing = User::factory()->create();
    $existing->username = 'marscheung';
    $existing->save();

    $newUser = User::factory()->create();

    $response = $this->actingAs($newUser)->postJson('/api/onboarding/step-1', [
        'first_name' => 'Märs',
        'last_name' => 'Cheung',
        'username' => 'MärsCheung',
    ]);

    $response->assertStatus(422);
    $response->assertJsonStructure(['message', 'errors' => ['username']]);
    expect($response->json('errors.username.0'))->toBeString()->not->toBeEmpty();
});

it('rejects reserved usernames, seeded as data', function () {
    $this->seed(ReservedUsernameSeeder::class);

    $user = User::factory()->create();

    $response = $this->actingAs($user)->postJson('/api/onboarding/step-1', [
        'first_name' => 'A',
        'last_name' => 'Dmin',
        'username' => 'admin',
    ]);

    $response->assertStatus(422);
    $response->assertJsonValidationErrors('username');
});

it('rejects a malformed username', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->postJson('/api/onboarding/step-1', [
        'first_name' => 'A',
        'last_name' => 'B',
        'username' => '-oops-',
    ]);

    $response->assertStatus(422);
    $response->assertJsonValidationErrors('username');
});
