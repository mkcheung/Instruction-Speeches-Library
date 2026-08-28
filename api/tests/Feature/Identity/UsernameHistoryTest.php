<?php

use App\Models\User;
use App\Services\UsernameService;
use Illuminate\Validation\ValidationException;

it('records a released username in history and refuses it to a different user', function () {
    $owner = User::factory()->create();
    app(UsernameService::class)->set($owner, 'original-handle');

    // Simulate the 30-day cooldown having elapsed so the rename is allowed.
    $owner->username_changed_at = now()->subDays(31);
    $owner->save();

    app(UsernameService::class)->set($owner, 'new-handle');

    $squatter = User::factory()->create();

    expect(fn () => app(UsernameService::class)->set($squatter, 'original-handle'))
        ->toThrow(ValidationException::class);
});

it('refuses a username change inside the 30-day cooldown', function () {
    $user = User::factory()->create();
    app(UsernameService::class)->set($user, 'first-handle');

    expect(fn () => app(UsernameService::class)->set($user, 'second-handle'))
        ->toThrow(ValidationException::class);
});

it('resolves /u/{username} for the current owner', function () {
    $user = User::factory()->create(['first_name' => 'Ada', 'last_name' => 'Lovelace']);
    app(UsernameService::class)->set($user, 'ada');

    $response = $this->getJson('/api/u/ada');

    $response->assertOk();
    $response->assertJsonPath('profile.username', 'ada');
});

it('returns 404 (not the new owner) for a released username', function () {
    $owner = User::factory()->create();
    app(UsernameService::class)->set($owner, 'released-handle');
    $owner->username_changed_at = now()->subDays(31);
    $owner->save();
    app(UsernameService::class)->set($owner, 'renamed-away');

    $response = $this->getJson('/api/u/released-handle');

    $response->assertStatus(404);
});

/**
 * Post-STEP-10 code review: UsernameService re-checked history but not
 * current occupancy, so a name held by a LIVE user reached save() and hit
 * the unique index as an uncaught QueryException.
 */
it('refuses a username currently held by another live user with a validation error', function () {
    User::factory()->create(['username' => 'ada']);
    $other = User::factory()->create(['username' => 'grace']);

    // App\Rules\UsernameIsAvailable has this check; the service — which its
    // own docblock calls "the one place a username is ever written", whose
    // invariant "must hold even for a caller that reaches set() directly" —
    // did not.
    expect(fn () => app(UsernameService::class)->set($other, 'ada'))
        ->toThrow(ValidationException::class);
});

it('still lets a user re-set their own current username', function () {
    $user = User::factory()->create(['username' => 'ada']);

    expect(app(UsernameService::class)->set($user, 'ada')->username)->toBe('ada');
});
