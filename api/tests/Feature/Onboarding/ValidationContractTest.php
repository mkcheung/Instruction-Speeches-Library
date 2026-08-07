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
