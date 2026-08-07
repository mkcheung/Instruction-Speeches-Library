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
