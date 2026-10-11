<?php

use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Support\Facades\Notification;

it('registers a new user with just email and password', function () {
    // CreateNewUser now assigns `member` unconditionally (§7.1), so this
    // route 500s with RoleDoesNotExist unless the role exists first.
    $this->seed(RoleSeeder::class);
    Notification::fake();

    $response = $this->postJson('/register', [
        'email' => 'newuser@example.com',
        'password' => 'correct-horse-battery-staple',
        'password_confirmation' => 'correct-horse-battery-staple',
    ]);

    $response->assertCreated();

    $user = User::query()->where('email', 'newuser@example.com')->first();
    expect($user)->not->toBeNull();
    expect($user->email_verified_at)->toBeNull();
    // names/username are onboarding step 1, not registration (§6.5).
    expect($user->first_name)->toBeNull();
    expect($user->username)->toBeNull();

    // Every user gets an (initially empty) profiles row immediately.
    expect($user->profile)->not->toBeNull();
    expect($user->profile->onboarding_completed_at)->toBeNull();

    Notification::assertSentTo($user, VerifyEmail::class);
});

it('returns the standard 422 contract on bad registration input', function () {
    $response = $this->postJson('/register', [
        'email' => 'not-an-email',
        'password' => 'short',
        'password_confirmation' => 'different',
    ]);

    $response->assertStatus(422);
    $response->assertJsonStructure(['message', 'errors' => ['email', 'password']]);
});

it('refuses to register a duplicate email', function () {
    User::factory()->create(['email' => 'taken@example.com']);

    $response = $this->postJson('/register', [
        'email' => 'taken@example.com',
        'password' => 'correct-horse-battery-staple',
        'password_confirmation' => 'correct-horse-battery-staple',
    ]);

    $response->assertStatus(422);
    $response->assertJsonValidationErrors('email');
});

it('assigns the member role to a newly registered user', function () {
    $this->seed(RoleSeeder::class);
    Notification::fake();

    $response = $this->postJson('/register', [
        'email' => 'newmember@example.com',
        'password' => 'correct-horse-battery-staple',
        'password_confirmation' => 'correct-horse-battery-staple',
    ]);

    $response->assertCreated();

    $user = User::query()->where('email', 'newmember@example.com')->firstOrFail();
    expect($user->hasRole('member'))->toBeTrue();
});

it('excludes a freshly registered member from reviewerCandidates because they have no username yet', function () {
    $this->seed(RoleSeeder::class);
    Notification::fake();

    $response = $this->postJson('/register', [
        'email' => 'nousername@example.com',
        'password' => 'correct-horse-battery-staple',
        'password_confirmation' => 'correct-horse-battery-staple',
    ]);

    $response->assertCreated();

    $user = User::query()->where('email', 'nousername@example.com')->firstOrFail();
    // Registration deliberately leaves username null (it's set at onboarding
    // step 1), and scopeReviewerCandidates requires a non-null username, so
    // this user must not be a selectable reviewer yet even though they hold
    // the member role.
    $candidateIds = User::query()->reviewerCandidates()->pluck('id');
    expect($candidateIds)->not->toContain($user->id);
});

it('includes a member with a username set in reviewerCandidates', function () {
    $this->seed(RoleSeeder::class);

    $user = User::factory()->create(['username' => 'reviewable']);
    $user->assignRole('member');

    $candidateIds = User::query()->reviewerCandidates()->pluck('id');
    expect($candidateIds)->toContain($user->id);
});
