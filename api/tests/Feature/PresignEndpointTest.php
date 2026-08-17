<?php

use App\Models\Review;
use App\Models\Speech;
use App\Models\User;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Storage;

// P0 fix (PLAN-APP-HEADER.md): the route only exists at all when both
// halves of the guard pass, mirroring the frontend's double guard
// (web/src/lib/spikes-guard.ts). APP_ENV is already 'testing' (phpunit.xml),
// so each test here sets the second half explicitly. It also only signs
// paths the ownership-scoped allow-list recognizes as belonging to the
// caller — see PresignController::pathIsAccessibleTo.
function fakeSignedUrl(): void
{
    $fake = Mockery::mock(FilesystemAdapter::class);
    $fake->shouldReceive('temporaryUrl')
        ->once()
        ->andReturn('https://seaweedfs.test/media/signed?X-Amz-Signature=fake');

    Storage::shouldReceive('disk')->with('media_public')->andReturn($fake);
}

test('GET /api/spikes/presign signs the caller\'s own speech video path', function () {
    Config::set('app.enable_spikes', true);
    fakeSignedUrl();

    $owner = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $response = $this->actingAs($owner)
        ->getJson("/api/spikes/presign?path=speeches/{$speech->ulid}/{$speech->ulid}/720p.mp4");

    $response->assertOk()->assertJson(['url' => 'https://seaweedfs.test/media/signed?X-Amz-Signature=fake']);
});

test('GET /api/spikes/presign signs a path for a reviewer with access-granting status', function () {
    Config::set('app.enable_spikes', true);
    fakeSignedUrl();

    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->accepted()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $owner->id,
    ]);

    $response = $this->actingAs($reviewer)
        ->getJson("/api/spikes/presign?path=speeches/{$speech->ulid}/{$speech->ulid}/720p.mp4");

    $response->assertOk();
});

test('GET /api/spikes/presign refuses a speech the caller has no access to (the P0 escalation)', function () {
    Config::set('app.enable_spikes', true);

    $owner = User::factory()->create();
    $unrelated = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $response = $this->actingAs($unrelated)
        ->getJson("/api/spikes/presign?path=speeches/{$speech->ulid}/{$speech->ulid}/720p.mp4");

    $response->assertForbidden();
});

test('GET /api/spikes/presign refuses a declined-then-revoked reviewer, the exact P0 population', function () {
    Config::set('app.enable_spikes', true);

    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->declined()->create([
        'speech_id' => $speech->id,
        'reviewer_id' => $reviewer->id,
        'speech_owner_id' => $owner->id,
    ]);

    $response = $this->actingAs($reviewer)
        ->getJson("/api/spikes/presign?path=speeches/{$speech->ulid}/{$speech->ulid}/720p.mp4");

    $response->assertForbidden();
});

test('GET /api/spikes/presign signs the caller\'s own avatar path', function () {
    Config::set('app.enable_spikes', true);
    fakeSignedUrl();

    $user = User::factory()->create();

    $response = $this->actingAs($user)
        ->getJson("/api/spikes/presign?path=avatars/{$user->id}/01ABC.jpg");

    $response->assertOk();
});

test('GET /api/spikes/presign refuses another user\'s avatar path', function () {
    Config::set('app.enable_spikes', true);

    $user = User::factory()->create();
    $other = User::factory()->create();

    $response = $this->actingAs($user)
        ->getJson("/api/spikes/presign?path=avatars/{$other->id}/01ABC.jpg");

    $response->assertForbidden();
});

test('GET /api/spikes/presign refuses a path outside the recognized shapes', function () {
    Config::set('app.enable_spikes', true);

    $response = $this->actingAs(User::factory()->create())
        ->getJson('/api/spikes/presign?path=whatever/else.mp4');

    $response->assertForbidden();
});

test('GET /api/spikes/presign requires a path', function () {
    Config::set('app.enable_spikes', true);

    $response = $this->actingAs(User::factory()->create())
        ->getJson('/api/spikes/presign');

    $response->assertUnprocessable();
});

test('GET /api/spikes/presign does not exist when the opt-in flag is off', function () {
    Config::set('app.enable_spikes', false);

    $response = $this->actingAs(User::factory()->create())
        ->getJson('/api/spikes/presign?path=avatars/1/01ABC.jpg');

    $response->assertNotFound();
});

test('GET /api/spikes/presign requires authentication even when enabled', function () {
    Config::set('app.enable_spikes', true);

    $response = $this->getJson('/api/spikes/presign?path=avatars/1/01ABC.jpg');

    $response->assertUnauthorized();
});
