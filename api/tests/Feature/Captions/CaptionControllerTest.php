<?php

use App\Jobs\RederiveTranscript;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

/**
 * `GET`/`PUT /speeches/{speech}/captions` — the frozen STEP-09 backend
 * contract §4. Every success body is enveloped (`{ captions: {...} }`),
 * matching EssayController's convention. No optimistic-locking/409 here —
 * the contract is explicit that single-speaker VTT editing has no
 * concurrent-writer scenario to guard against.
 */
it('returns an unavailable empty state when no captions asset exists yet', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}/captions");

    $response->assertOk();
    $response->assertJsonPath('captions.status', 'unavailable');
    $response->assertJsonPath('captions.vtt', null);
});

it('returns the VTT text when the captions asset is ready', function () {
    Storage::fake('media');

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($captions->path, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi.");

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}/captions");

    $response->assertOk();
    $response->assertJsonPath('captions.status', 'ready');
    $response->assertJsonPath('captions.vtt', "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi.");
});

it('does not leak VTT text while the caption job is still processing', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    SpeechAsset::factory()->for($speech)->captions()->create(['status' => 'processing']);

    $response = $this->actingAs($user)->getJson("/api/speeches/{$speech->id}/captions");

    $response->assertJsonPath('captions.status', 'processing');
    $response->assertJsonPath('captions.vtt', null);
});

it('an accepted reviewer can read captions', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->accepted()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    $this->actingAs($reviewer)->getJson("/api/speeches/{$speech->id}/captions")->assertOk();
});

it('a stranger cannot read captions', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();

    $this->actingAs($stranger)->getJson("/api/speeches/{$speech->id}/captions")->assertForbidden();
});

it('the owner can PUT a valid VTT, which persists it and dispatches the re-derive job', function () {
    Queue::fake();
    Storage::fake('media');

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();

    $vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nToastmasters, not toast masters.";

    $response = $this->actingAs($user)->putJson("/api/speeches/{$speech->id}/captions", ['vtt' => $vtt]);

    $response->assertOk();
    $response->assertJsonPath('captions.status', 'ready');
    $response->assertJsonPath('captions.vtt', $vtt);

    $captions = SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->sole();
    expect($captions->status)->toBe('ready');
    Storage::disk($captions->disk)->assertExists($captions->path);

    Queue::assertPushed(RederiveTranscript::class, fn ($job) => $job->captionsAssetId === $captions->id);
});

it('rejects a malformed VTT with 422', function () {
    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();

    $response = $this->actingAs($user)->putJson("/api/speeches/{$speech->id}/captions", [
        'vtt' => 'This is not WebVTT at all.',
    ]);

    $response->assertStatus(422);
    $response->assertJsonValidationErrors('vtt');
});

it('a reviewer cannot PUT captions, even an accepted one', function () {
    $owner = User::factory()->create();
    $reviewer = User::factory()->create();
    $speech = Speech::factory()->for($owner)->create();
    Review::factory()->accepted()->create(['speech_id' => $speech->id, 'reviewer_id' => $reviewer->id, 'speech_owner_id' => $owner->id]);

    $this->actingAs($reviewer)->putJson("/api/speeches/{$speech->id}/captions", [
        'vtt' => "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi.",
    ])->assertForbidden();
});

it('an admin cannot PUT captions either (ownership-only, no admin override)', function () {
    $this->seed(RoleSeeder::class);
    $owner = User::factory()->create();
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $speech = Speech::factory()->for($owner)->create();

    $this->actingAs($admin)->putJson("/api/speeches/{$speech->id}/captions", [
        'vtt' => "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi.",
    ])->assertForbidden();
});

it('editing overwrites an existing captions asset in place rather than creating a second row', function () {
    Queue::fake();
    Storage::fake('media');

    $user = User::factory()->create();
    $speech = Speech::factory()->for($user)->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);
    Storage::disk('media')->put($captions->path, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOld.");

    $newVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nNew.";
    $this->actingAs($user)->putJson("/api/speeches/{$speech->id}/captions", ['vtt' => $newVtt])->assertOk();

    expect(SpeechAsset::query()->where('speech_id', $speech->id)->where('kind', 'captions')->count())->toBe(1);
    expect(Storage::disk('media')->get($captions->fresh()->path))->toBe($newVtt);
});
