<?php

use App\Models\User;
use Illuminate\Http\UploadedFile;

/**
 * Laravel's default validation-exception JSON shape
 * ({"message":..., "errors": {field: [messages]}}) must be what every
 * endpoint actually returns on a 422 — not something Fortify or a custom
 * exception handler quietly reshapes (§6.5's "the one thing to share is
 * the error contract").
 */
it('returns the standard 422 contract on onboarding step 1', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->postJson('/api/onboarding/step-1', [
        'first_name' => '',
        'last_name' => '',
        'username' => '',
    ]);

    $response->assertStatus(422);
    $response->assertJsonStructure(['message', 'errors' => ['first_name', 'last_name', 'username']]);
});

it('returns the standard 422 contract on onboarding step 2', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user)->postJson('/api/onboarding/step-2', [
        'bio' => str_repeat('x', 1001),
    ]);

    $response->assertStatus(422);
    $response->assertJsonStructure(['message', 'errors' => ['bio']]);
});

it('returns the standard 422 contract on avatar upload with a non-image file', function () {
    $user = User::factory()->create();

    $file = UploadedFile::fake()->create('not-an-image.txt', 10, 'text/plain');

    $response = $this->actingAs($user)->postJson('/api/avatar', [
        'avatar' => $file,
    ]);

    $response->assertStatus(422);
    $response->assertJsonStructure(['message', 'errors' => ['avatar']]);
});

it('preserves shared text limits and nullable omissions for onboarding and profile edits', function (string $field, int $limit) {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->postJson('/api/onboarding/step-2', [$field => str_repeat('x', $limit)])->assertOk();
    $this->patchJson('/api/profile', [$field => str_repeat('y', $limit)])->assertOk();
    $this->postJson('/api/onboarding/step-2', [$field => str_repeat('x', $limit + 1)])
        ->assertUnprocessable()->assertJsonValidationErrors($field);
    $this->patchJson('/api/profile', [$field => str_repeat('x', $limit + 1)])
        ->assertUnprocessable()->assertJsonValidationErrors($field);
    expect($user->fresh('profile')->profile->{$field})->toBe(str_repeat('y', $limit));
    $this->postJson('/api/onboarding/step-2', [$field => null])->assertOk();
    $this->patchJson('/api/profile', [$field => null])->assertOk();
})->with([['bio', 1000], ['pronouns', 32], ['location', 80]]);

it('keeps onboarding avatar optional and nullable while replacement requires a file', function () {
    $user = User::factory()->create();
    $this->actingAs($user)->postJson('/api/onboarding/step-3', [])->assertOk();
    $this->postJson('/api/onboarding/step-3', ['avatar' => null])->assertOk();
    $this->postJson('/api/avatar', [])->assertUnprocessable()->assertJsonValidationErrors('avatar');
    $this->postJson('/api/avatar', ['avatar' => null])->assertUnprocessable()->assertJsonValidationErrors('avatar');
});
