<?php

use App\Models\User;
use App\Models\UsernameHistory;
use App\Services\UsernameService;
use Illuminate\Database\QueryException;
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

/**
 * R3: decisions are made on fresh locked state, and history + rename commit
 * together.
 */
it('treats a stale snapshot of an already-renamed user as a no-op for the same name', function () {
    $stale = User::factory()->create();
    User::query()->whereKey($stale->id)->update(['username' => 'ada', 'username_changed_at' => now()]);

    $result = app(UsernameService::class)->set($stale, 'ada');

    expect($result->username)->toBe('ada');
    expect(UsernameHistory::query()->where('user_id', $stale->id)->count())->toBe(0);
});

it('applies the cooldown and writes history when a stale first-claim snapshot meets a live username', function () {
    $stale = User::factory()->create();
    expect($stale->username)->toBeNull();
    app(UsernameService::class)->set(User::findOrFail($stale->id), 'first-claim');

    expect(fn () => app(UsernameService::class)->set($stale, 'second-claim'))
        ->toThrow(ValidationException::class);

    expect(User::findOrFail($stale->id)->username)->toBe('first-claim');
    expect(UsernameHistory::query()->where('user_id', $stale->id)->count())->toBe(0);
});

it('writes history for the live username, not the stale snapshot, after the cooldown', function () {
    $stale = User::factory()->create();
    User::query()->whereKey($stale->id)->update(['username' => 'live-name', 'username_changed_at' => now()->subDays(40)]);

    $returned = app(UsernameService::class)->set($stale, 'next-name');

    expect($returned->username)->toBe('next-name');
    expect(UsernameHistory::query()->where('user_id', $stale->id)->pluck('username')->all())->toBe(['live-name']);
});

it('leaves no history behind when the rename save fails', function () {
    $user = User::factory()->create(['username' => 'keeper', 'username_changed_at' => now()->subDays(40)]);

    User::saving(function () {
        throw new RuntimeException('save blew up');
    });

    try {
        expect(fn () => app(UsernameService::class)->set($user, 'new-name'))
            ->toThrow(RuntimeException::class);
    } finally {
        User::flushEventListeners();
        User::clearBootedModels();
    }

    expect(UsernameHistory::query()->count())->toBe(0);
    expect(User::findOrFail($user->id)->username)->toBe('keeper');
});

it('maps a username unique-index race to the existing taken validation error', function () {
    $user = User::factory()->create();
    $raced = false;

    User::saving(function () use (&$raced) {
        if (! $raced) {
            $raced = true;
            User::withoutEvents(fn () => User::factory()->create(['username' => 'contested']));
        }
    });

    try {
        $thrown = null;
        try {
            app(UsernameService::class)->set($user, 'contested');
        } catch (ValidationException $e) {
            $thrown = $e;
        }
    } finally {
        User::flushEventListeners();
        User::clearBootedModels();
    }

    expect($thrown)->not->toBeNull();
    expect($thrown->errors())->toBe(['username' => ['That username is already taken.']]);
    expect(UsernameHistory::query()->count())->toBe(0);
});

it('propagates unrelated database errors instead of reporting a username conflict', function () {
    $user = User::factory()->create();

    User::saving(function () {
        throw new QueryException('sqlite', 'insert into x', [], new PDOException('disk I/O error'));
    });

    try {
        expect(fn () => app(UsernameService::class)->set($user, 'whatever'))
            ->toThrow(QueryException::class);
    } finally {
        User::flushEventListeners();
        User::clearBootedModels();
    }
});
