<?php

use App\Jobs\NormalizeVoiceNote;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->seed(RoleSeeder::class);
    $this->owner = User::factory()->create();
    $this->owner->assignRole('member');
    $this->coach = User::factory()->create();
    $this->coach->assignRole('coach');
    $this->speech = Speech::factory()->for($this->owner)->create();
    $this->review = Review::factory()->accepted()->create([
        'speech_id' => $this->speech->id, 'speech_owner_id' => $this->owner->id,
        'reviewer_id' => $this->coach->id, 'status' => 'in_progress',
    ]);
    SpeechAsset::factory()->video()->ready()->for($this->speech)->create(['duration_seconds' => '200.000']);
    $this->url = "/api/speeches/{$this->speech->id}/annotations";
    $this->actingAs($this->coach);
    Storage::fake('media');
    Queue::fake();
});

function timedPayload(float|string $start = 10, float|string $duration = 5): array
{
    return ['client_uuid' => (string) Str::uuid(), 'body' => 'Specific feedback', 'start_seconds' => $start, 'duration_seconds' => $duration];
}

it('admits adjacent ranges and returns an idempotent original before checking its occupied slot', function () {
    $payload = timedPayload();
    $first = $this->postJson($this->url, $payload)->assertCreated()->assertJsonPath('annotation.timing_type', 'range');
    $this->postJson($this->url, [...$payload, 'body' => 'Uncertain retry changed text'])
        ->assertOk()->assertJsonPath('annotation.id', $first->json('annotation.id'))->assertJsonPath('annotation.body', $payload['body']);
    $this->postJson($this->url, timedPayload(15))->assertCreated();
    expect($this->review->fresh()->annotations_count)->toBe(2);
});

it('rejects every overlapping range shape and never creates counters or rows', function ($start, $duration) {
    $this->postJson($this->url, timedPayload())->assertCreated();
    $this->postJson($this->url, timedPayload($start, $duration))->assertUnprocessable()
        ->assertJsonPath('code', 'annotation_overlap')->assertJsonCount(1, 'conflicts');
    expect(Annotation::where('review_id', $this->review->id)->count())->toBe(1)
        ->and($this->review->fresh()->annotations_count)->toBe(1);
})->with([[10, 5], [9, 2], [14.999, 3], [11, 1], [9, 10]]);

it('checks pending voice points as points, before quota assets objects or jobs', function () {
    $this->postJson($this->url, timedPayload())->assertCreated();
    $voiceUrl = "/api/speeches/{$this->speech->id}/voice-notes";
    $upload = fn ($at) => ['client_uuid' => (string) Str::uuid(), 'start_seconds' => $at,
        'audio' => UploadedFile::fake()->create('note.webm', 4, 'audio/webm')];
    $this->post($voiceUrl, $upload(10), ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonPath('code', 'annotation_overlap');
    expect($this->coach->fresh()->storage_bytes_used)->toBe(0);
    expect(SpeechAsset::where('kind', 'voice_note')->count())->toBe(0);
    Queue::assertNotPushed(NormalizeVoiceNote::class);
    $this->post($voiceUrl, $upload(15), ['Accept' => 'application/json'])->assertAccepted()->assertJsonPath('annotation.timing_type', 'point');
    $charged = $this->coach->fresh()->storage_bytes_used;
    $this->post($voiceUrl, $upload(15), ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonPath('code', 'annotation_overlap');
    $this->postJson($this->url, timedPayload(15))->assertUnprocessable()->assertJsonPath('code', 'annotation_overlap');
    $this->postJson($this->url, timedPayload('15.001'))->assertCreated();
    expect($this->coach->fresh()->storage_bytes_used)->toBe($charged);
    Queue::assertPushed(NormalizeVoiceNote::class, 1);
});

it('keeps other reviewers independent and their private notes out of conflict responses', function () {
    $peer = User::factory()->create();
    $peerReview = Review::factory()->accepted()->create(['speech_id' => $this->speech->id,
        'speech_owner_id' => $this->owner->id, 'reviewer_id' => $peer->id]);
    $secret = Annotation::factory()->draft()->for($peerReview)->create(['start_seconds' => 10]);
    $this->postJson($this->url, timedPayload())->assertCreated();
    $response = $this->postJson($this->url, timedPayload());
    $response->assertUnprocessable();
    expect(array_column($response->json('conflicts'), 'id'))->not->toContain((string) $secret->id);
});

it('validates effective retimes excluding self and preserves stale-version precedence', function () {
    $first = $this->postJson($this->url, timedPayload())->json('annotation');
    $second = $this->postJson($this->url, timedPayload(20))->json('annotation');
    $url = "{$this->url}/{$second['id']}";
    $this->patchJson($url, ['lock_version' => 0, 'start_seconds' => 14])->assertUnprocessable()->assertJsonPath('code', 'annotation_overlap');
    $this->patchJson($url, ['lock_version' => 0, 'start_seconds' => 15])->assertOk()->assertJsonPath('annotation.lock_version', 1);
    $this->patchJson($url, ['lock_version' => 0, 'start_seconds' => 12])->assertConflict()->assertJsonPath('conflictSource', 'self');
    $this->patchJson("{$this->url}/{$first['id']}", ['lock_version' => 0, 'body' => 'Changed body'])->assertOk();
});

it('preserves erased point identity and blocks generic timing edits even with no audio', function () {
    $point = Annotation::factory()->for($this->review)->create(['timing_type' => 'point',
        'audio_asset_id' => null, 'body' => 'Preserved transcript', 'transcript_status' => 'ready', 'start_seconds' => 10]);
    $this->patchJson("{$this->url}/{$point->id}", ['lock_version' => 0, 'start_seconds' => 20])->assertUnprocessable();
    $this->patchJson("{$this->url}/{$point->id}", ['lock_version' => 0, 'body' => 'Corrected transcript'])->assertOk()->assertJsonPath('annotation.timing_type', 'point');
    $this->postJson($this->url, timedPayload(11))->assertCreated();
});

it('restores only an own erased point in the same row with original publication and exactly-once counts', function () {
    $point = Annotation::factory()->for($this->review)->create(['timing_type' => 'point', 'start_seconds' => 10]);
    $this->review->update(['annotations_count' => 1, 'published_annotations_count' => 1]);
    $this->deleteJson("{$this->url}/{$point->id}")->assertNoContent();
    $restore = "{$this->url}/{$point->id}/restore-point";
    $this->postJson($restore)->assertOk()->assertJsonPath('annotation.id', (string) $point->id)->assertJsonPath('annotation.timing_type', 'point');
    $this->postJson($restore)->assertOk();
    expect($this->review->fresh()->annotations_count)->toBe(1)
        ->and($this->review->fresh()->published_annotations_count)->toBe(1)
        ->and($point->fresh()->published_at)->not->toBeNull();
});

it('rejects point Undo when a range has occupied its freed position', function () {
    $point = Annotation::factory()->draft()->for($this->review)->create(['timing_type' => 'point', 'start_seconds' => 10]);
    $this->review->update(['annotations_count' => 1]);
    $this->deleteJson("{$this->url}/{$point->id}")->assertNoContent();
    $this->postJson($this->url, timedPayload(10))->assertCreated();
    $this->postJson("{$this->url}/{$point->id}/restore-point")->assertUnprocessable()->assertJsonPath('code', 'annotation_overlap');
    expect($point->fresh()->deleted_at)->not->toBeNull()
        ->and($this->review->fresh()->annotations_count)->toBe(1);
});

it('does not turn point restore into an admin or peer bypass', function () {
    $point = Annotation::factory()->for($this->review)->create(['timing_type' => 'point', 'deleted_at' => now()]);
    $admin = User::factory()->create();
    $admin->assignRole('admin');
    $this->actingAs($admin)->postJson("{$this->url}/{$point->id}/restore-point")->assertNotFound();
    $peer = User::factory()->create();
    $peer->assignRole('coach');
    Review::factory()->accepted()->create(['speech_id' => $this->speech->id, 'speech_owner_id' => $this->owner->id, 'reviewer_id' => $peer->id]);
    $this->actingAs($peer)->postJson("{$this->url}/{$point->id}/restore-point")->assertNotFound();
});

it('denies an admin even if historical data assigns their own active review', function () {
    $point = Annotation::factory()->for($this->review)->create(['timing_type' => 'point', 'deleted_at' => now()]);
    $this->coach->assignRole('admin');
    $this->postJson("{$this->url}/{$point->id}/restore-point")->assertForbidden();
    expect($point->fresh()->trashed())->toBeTrue();
});

it('keeps point restore idempotent at the cap while rejecting a new restored slot', function () {
    $live = Annotation::factory()->for($this->review)->create(['timing_type' => 'point', 'start_seconds' => 1]);
    $deleted = Annotation::factory()->for($this->review)->create(['timing_type' => 'point', 'start_seconds' => 2, 'deleted_at' => now()]);
    $this->review->update(['annotations_count' => 200]);
    $this->postJson("{$this->url}/{$live->id}/restore-point")->assertOk();
    $this->postJson("{$this->url}/{$deleted->id}/restore-point")->assertUnprocessable();
    expect($deleted->fresh()->trashed())->toBeTrue()
        ->and($this->review->fresh()->annotations_count)->toBe(200);
});

it('validates video bounds and limits without changing the old metadata defaults', function ($start, $duration) {
    $this->postJson($this->url, timedPayload($start, $duration))->assertUnprocessable();
})->with([[199, 2], [0, 0.499], [0, 120.001], [200, 1], ['10000000', 1]]);

it('requires ready metadata for new admission but allows unchanged legacy body edits', function () {
    $legacy = Annotation::factory()->for($this->review)->create(['start_seconds' => 199, 'duration_seconds' => 6, 'kind' => 'praise', 'topic' => 'delivery']);
    SpeechAsset::query()->where('speech_id', $this->speech->id)->update(['status' => 'processing']);
    $this->postJson($this->url, timedPayload())->assertUnprocessable();
    $this->patchJson("{$this->url}/{$legacy->id}", ['lock_version' => 0, 'body' => 'Preserved legacy text'])
        ->assertOk()->assertJsonPath('annotation.kind', 'praise')->assertJsonPath('annotation.topic', 'delivery');
});
