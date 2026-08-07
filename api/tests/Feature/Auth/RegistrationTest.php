<?php

use App\Models\User;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Support\Facades\Notification;

it('registers a new user with just email and password', function () {
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
