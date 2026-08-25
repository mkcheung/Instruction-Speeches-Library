<?php

use App\Jobs\EraseSelfAccount;
use App\Jobs\NormalizeVoiceNote;
use App\Jobs\TranscribeVoiceNote;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\Voice\EraseReviewerVoiceNotes;
use App\Services\Voice\VoiceNoteTranscriberContract;
use Database\Seeders\RoleSeeder;
use Illuminate\Contracts\Bus\Dispatcher;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

function voiceReview(string $role = 'coach'): array
{
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $reviewer = User::factory()->create();
    $reviewer->assignRole($role);
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $reviewer->id, 'status' => 'in_progress']);

    return [$speaker, $reviewer, $speech, $review];
}

it('accepts a bounded direct voice upload and is idempotent without multipart bookkeeping', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $uuid = (string) Str::uuid();
    $payload = ['audio' => UploadedFile::fake()->create('note.webm', 20, 'audio/webm'), 'client_uuid' => $uuid, 'start_seconds' => 2.5];
    $first = $this->actingAs($coach)->post("/api/speeches/{$speech->id}/voice-notes", $payload);
    $first->assertAccepted()->assertJsonPath('annotation.voice.audio_status', 'processing');
    $second = $this->actingAs($coach)->post("/api/speeches/{$speech->id}/voice-notes", $payload);
    $second->assertOk()->assertJsonPath('annotation.id', $first->json('annotation.id'));
    expect(Annotation::where('review_id', $review->id)->count())->toBe(1);
    $asset = SpeechAsset::where('kind', 'voice_note')->firstOrFail();
    expect($asset->upload_id)->toBeNull()
        ->and($asset->temporary_path)->toBe("voice-uploads/{$coach->id}/{$review->id}/{$uuid}/source");
    Storage::disk('media')->assertExists($asset->temporary_path);
    expect($coach->fresh()->uploads_in_flight)->toBe(0);
    Queue::assertPushed(NormalizeVoiceNote::class, 1);
});

it('fails and cleans a committed voice reservation when after-commit dispatch fails', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, $coach, $speech, $review] = voiceReview();
    $dispatcher = Mockery::mock(Dispatcher::class);
    $dispatcher->shouldReceive('dispatch')->once()->andThrow(new RuntimeException('redis unavailable'));
    app()->instance(Dispatcher::class, $dispatcher);

    $response = $this->actingAs($coach)->withHeader('Accept', 'application/json')->post("/api/speeches/{$speech->id}/voice-notes", [
        'audio' => UploadedFile::fake()->create('note.webm', 10, 'audio/webm'),
        'client_uuid' => (string) Str::uuid(),
        'start_seconds' => 1,
    ]);
    $response->assertServerError();

    $annotation = Annotation::where('review_id', $review->id)->firstOrFail();
    $asset = SpeechAsset::findOrFail($annotation->audio_asset_id);
    expect($asset->status)->toBe('failed')
        ->and($asset->failure_code)->toBe('voice_normalization_failed')
        ->and($asset->temporary_path)->toBeNull()
        ->and($asset->temporary_byte_size)->toBeNull()
        ->and($annotation->transcript_status)->toBe('failed')
        ->and($coach->fresh()->storage_bytes_used)->toBe(0);
    expect(Storage::disk('media')->allFiles())->toBe([]);
});

it('denies direct voice creation to a member even when text commentary is allowed', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $member, $speech] = voiceReview('member');
    $this->actingAs($member)->post("/api/speeches/{$speech->id}/voice-notes", ['audio' => UploadedFile::fake()->create('note.webm', 10, 'audio/webm'), 'client_uuid' => (string) Str::uuid(), 'start_seconds' => 1])->assertForbidden();
});

it('categorically denies dual-role administrators from direct voice creation', function (string $privilegedRole) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $coach->assignRole($privilegedRole);

    $this->actingAs($coach)->post("/api/speeches/{$speech->id}/voice-notes", [
        'audio' => UploadedFile::fake()->create('note.webm', 10, 'audio/webm'),
        'client_uuid' => (string) Str::uuid(),
        'start_seconds' => 1,
    ])->assertForbidden();

    expect(Annotation::where('review_id', $review->id)->exists())->toBeFalse();
    Queue::assertNothingPushed();
})->with(['admin', 'super_admin']);

it('denies voice creation when the coach review is not access-granting or is revoked', function (string $status, bool $revoked) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $review->update(['status' => $status, 'revoked_at' => $revoked ? now() : null]);

    $this->actingAs($coach)->post("/api/speeches/{$speech->id}/voice-notes", [
        'audio' => UploadedFile::fake()->create('note.webm', 10, 'audio/webm'),
        'client_uuid' => (string) Str::uuid(),
        'start_seconds' => 1,
    ])->assertForbidden();

    expect(Annotation::where('review_id', $review->id)->exists())->toBeFalse();
})->with([
    'invited' => ['invited', false],
    'declined' => ['declined', false],
    'abandoned' => ['abandoned', false],
    'revoked accepted' => ['accepted', true],
]);

it('denies anonymous, unverified, owner, and unrelated callers without leaking another review', function (string $caller) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [$speaker, , $speech, $review] = voiceReview();
    $payload = [
        'audio' => UploadedFile::fake()->create('note.webm', 10, 'audio/webm'),
        'client_uuid' => (string) Str::uuid(),
        'start_seconds' => 1,
    ];
    $this->withHeader('Accept', 'application/json');

    if ($caller === 'anonymous') {
        $response = $this->post("/api/speeches/{$speech->id}/voice-notes", $payload);
        $response->assertUnauthorized();
    } else {
        $user = match ($caller) {
            'owner' => $speaker,
            'unverified' => User::factory()->unverified()->create(),
            default => User::factory()->create(),
        };
        $user->assignRole($caller === 'unverified' ? 'coach' : 'member');
        $response = $this->actingAs($user)->post("/api/speeches/{$speech->id}/voice-notes", $payload);
        $response->assertStatus($caller === 'unverified' ? 403 : 404);
    }

    expect(Annotation::where('review_id', $review->id)->exists())->toBeFalse();
    Queue::assertNothingPushed();
})->with(['anonymous', 'unverified', 'owner', 'stranger']);

it('returns only the frozen public voice resource fields', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech] = voiceReview();
    $response = $this->actingAs($coach)->post("/api/speeches/{$speech->id}/voice-notes", [
        'audio' => UploadedFile::fake()->create('note.webm', 10, 'audio/webm'),
        'client_uuid' => (string) Str::uuid(),
        'start_seconds' => 1,
    ])->assertAccepted()->assertJsonStructure([
        'annotation' => [
            'id', 'start_seconds', 'duration_seconds', 'kind', 'topic', 'body', 'lock_version', 'client_uuid',
            'voice' => ['asset_id', 'audio_status', 'transcript_status', 'failure_code'],
        ],
    ]);

    $json = json_encode($response->json(), JSON_THROW_ON_ERROR);
    expect($json)->not->toContain('temporary_path')
        ->not->toContain('byte_size')
        ->not->toContain('failure_detail')
        ->not->toContain('disk')
        ->not->toContain('speeches/');
});

it('requires a verified email across voice, preference, and erase-self APIs', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $annotation = Annotation::factory()->for($review)->create([
        'audio_asset_id' => $asset->id,
        'transcript_status' => 'failed',
    ]);
    $coach->forceFill(['email_verified_at' => null])->save();
    $this->actingAs($coach)->withHeader('Accept', 'application/json');

    $this->post("/api/speeches/{$speech->id}/voice-notes", [
        'audio' => UploadedFile::fake()->create('note.webm', 10, 'audio/webm'),
        'client_uuid' => (string) Str::uuid(),
        'start_seconds' => 1,
    ])->assertForbidden();
    $this->getJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}/voice-playback-url")->assertForbidden();
    $this->postJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}/voice-transcript/retry")->assertForbidden();
    $this->patchJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}", ['lock_version' => 0, 'body' => 'No'])->assertForbidden();
    $this->getJson("/api/me/preferences/voice-commentary/{$speech->id}")->assertForbidden();
    $this->patchJson("/api/me/preferences/voice-commentary/{$speech->id}", ['mode' => 'text', 'experienced' => true])->assertForbidden();
    $this->deleteJson('/api/me')->assertForbidden();
    Queue::assertNothingPushed();
});

it('stores per-speech voice preference without replacing unrelated preferences', function () {
    $this->seed(RoleSeeder::class);
    [$speaker, , $speech] = voiceReview();
    $speaker->update(['preferences' => ['unrelated' => ['kept' => true]]]);
    $this->actingAs($speaker)->getJson("/api/me/preferences/voice-commentary/{$speech->id}")->assertOk()->assertJsonPath('voice_commentary.mode', 'play');
    $this->actingAs($speaker)->patchJson("/api/me/preferences/voice-commentary/{$speech->id}", ['mode' => 'text', 'experienced' => true])->assertOk()->assertJsonPath('voice_commentary.mode', 'text');
    expect($speaker->fresh()->preferences['unrelated']['kept'])->toBeTrue();
});

it('retries only the current failed transcript with a fresh attempt token', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'failed', 'transcript_attempt_id' => (string) Str::uuid()]);
    $old = $annotation->transcript_attempt_id;
    $this->actingAs($coach)->postJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}/voice-transcript/retry")->assertAccepted()->assertJsonPath('annotation.voice.transcript_status', 'pending');
    expect($annotation->fresh()->transcript_attempt_id)->not->toBe($old);
    Queue::assertPushed(TranscribeVoiceNote::class, fn ($job) => $job->attemptId === $annotation->fresh()->transcript_attempt_id);
});

it('returns a failed retryable transcript state when retry dispatch fails', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $annotation = Annotation::factory()->for($review)->create([
        'audio_asset_id' => $asset->id,
        'transcript_status' => 'failed',
        'transcript_attempt_id' => (string) Str::uuid(),
    ]);
    $dispatcher = Mockery::mock(Dispatcher::class);
    $dispatcher->shouldReceive('dispatch')->once()->andThrow(new RuntimeException('redis unavailable'));
    app()->instance(Dispatcher::class, $dispatcher);

    $this->actingAs($coach)->withHeader('Accept', 'application/json')
        ->postJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}/voice-transcript/retry")
        ->assertServerError();
    expect($annotation->fresh()->transcript_status)->toBe('failed')
        ->and($annotation->fresh()->transcript_failure_code)->toBe('voice_transcription_failed');
});

it('rejects retiming a voice note and preserves voice metadata on transcript patch', function () {
    $this->seed(RoleSeeder::class);
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'ready']);
    foreach (['start_seconds' => 5, 'duration_seconds' => 5, 'kind' => 'praise', 'topic' => 'Changed'] as $field => $value) {
        $this->actingAs($coach)->patchJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}", ['lock_version' => 0, $field => $value])
            ->assertUnprocessable()->assertJsonValidationErrors($field);
    }
    $this->actingAs($coach)->patchJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}", ['lock_version' => 0, 'body' => 'Edited transcript'])->assertOk()->assertJsonPath('annotation.voice.asset_id', $asset->id);
});

it('restores the same soft-deleted voice note before delayed purge', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    Storage::disk('media')->put($asset->path, 'voice');
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'ready']);
    $review->update(['annotations_count' => 1]);
    $this->actingAs($coach)->deleteJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}")->assertNoContent();
    $this->actingAs($coach)->postJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}/restore")->assertOk()->assertJsonPath('annotation.voice.asset_id', $asset->id);
    expect($annotation->fresh())->not->toBeNull();
    Storage::disk('media')->assertExists($asset->path);
});

it('prevents a demoted member from editing a ready voice transcript', function () {
    $this->seed(RoleSeeder::class);
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'ready']);
    $coach->syncRoles(['member']);
    $this->actingAs($coach)->patchJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}", ['lock_version' => 0, 'body' => 'Not allowed'])->assertForbidden();
});

it('requires a verified active coach to delete a voice note', function (string $denial) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'ready']);
    if ($denial === 'demoted') {
        $coach->syncRoles(['member']);
    } else {
        $coach->forceFill(['email_verified_at' => null])->save();
    }

    $this->actingAs($coach)->deleteJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}")->assertForbidden();
    expect($annotation->fresh())->not->toBeNull();
    Queue::assertNothingPushed();
})->with(['demoted', 'unverified']);

it('does not let an obsolete transcript attempt overwrite a newer retry', function () {
    $this->seed(RoleSeeder::class);
    [, , $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $newAttempt = (string) Str::uuid();
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => '', 'transcript_status' => 'pending', 'transcript_attempt_id' => $newAttempt]);
    $obsolete = new TranscribeVoiceNote($annotation->id, $asset->id, (string) Str::uuid());
    $obsolete->handle(app(VoiceNoteTranscriberContract::class));
    expect($annotation->fresh()->transcript_status)->toBe('pending')->and($annotation->fresh()->body)->toBe('');
});

it('runs queued erase-self orchestration before reviewer identity is nulled', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready', 'byte_size' => 12]);
    Storage::disk('media')->put($asset->path, 'voice-bytes');
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => 'Keep this transcript.', 'start_seconds' => 7.25, 'duration_seconds' => 3.5, 'published_at' => now(), 'transcript_status' => 'ready']);
    User::query()->whereKey($coach->id)->update(['storage_bytes_used' => 12]);
    $this->actingAs($coach)->deleteJson('/api/me')->assertAccepted();
    Queue::assertPushed(EraseSelfAccount::class);
    (new EraseSelfAccount($coach->id))->handle(app(EraseReviewerVoiceNotes::class));
    expect($annotation->fresh()->audio_asset_id)->toBeNull()
        ->and($annotation->fresh()->body)->toBe('Keep this transcript.')
        ->and((float) $annotation->fresh()->start_seconds)->toBe(7.25)
        ->and((float) $annotation->fresh()->duration_seconds)->toBe(3.5)
        ->and($annotation->fresh()->published_at)->not->toBeNull()
        ->and($annotation->fresh()->transcript_status)->toBe('ready')
        ->and($review->fresh()->reviewer_id)->toBeNull()
        ->and($coach->fresh()->storage_bytes_used)->toBe(0);
    expect(SpeechAsset::find($asset->id))->toBeNull();
    Storage::disk('media')->assertMissing($asset->path);
    (new EraseSelfAccount($coach->id))->handle(app(EraseReviewerVoiceNotes::class));
    expect($coach->fresh()->storage_bytes_used)->toBe(0);
});

it('erases a persisted normalization candidate claimed before ready CAS', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, $coach, $speech, $review] = voiceReview();
    $temporary = "voice-uploads/{$coach->id}/{$review->id}/candidate/source";
    $candidate = "speeches/{$speech->ulid}/voice/candidate.m4a";
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create([
        'status' => 'processing',
        'byte_size' => 12,
        'temporary_path' => $temporary,
        'temporary_byte_size' => 12,
        'normalization_candidate_path' => $candidate,
    ]);
    Storage::disk('media')->put($temporary, 'raw-voice');
    Storage::disk('media')->put($candidate, 'normalized-aac');
    Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => 'Transcript survives.', 'transcript_status' => 'pending']);
    User::query()->whereKey($coach->id)->update(['storage_bytes_used' => 12]);

    (new EraseSelfAccount($coach->id))->handle(app(EraseReviewerVoiceNotes::class));

    expect(SpeechAsset::find($asset->id))->toBeNull()
        ->and($coach->fresh()->storage_bytes_used)->toBe(0)
        ->and($review->fresh()->reviewer_id)->toBeNull();
    Storage::disk('media')->assertMissing($temporary)->assertMissing($candidate);
});

it('erasure is scoped to the requested reviewer and missing objects are idempotent', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, $coachA, $speech, $reviewA] = voiceReview();
    $coachB = User::factory()->create();
    $coachB->assignRole('coach');
    $reviewB = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $speech->user_id, 'reviewer_id' => $coachB->id]);
    $assetA = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready', 'byte_size' => 5]);
    $assetB = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready', 'byte_size' => 7]);
    $noteA = Annotation::factory()->for($reviewA)->create(['audio_asset_id' => $assetA->id, 'body' => 'A', 'transcript_status' => 'ready']);
    $noteB = Annotation::factory()->for($reviewB)->create(['audio_asset_id' => $assetB->id, 'body' => 'B', 'transcript_status' => 'ready']);
    (new EraseSelfAccount($coachA->id))->handle(app(EraseReviewerVoiceNotes::class));
    expect($noteA->fresh()->audio_asset_id)->toBeNull()->and($noteB->fresh()->audio_asset_id)->toBe($assetB->id)->and($reviewB->fresh()->reviewer_id)->toBe($coachB->id);
});

it('does not clear reviewer identity when voice object deletion fails', function () {
    $this->seed(RoleSeeder::class);
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => 'Retained', 'transcript_status' => 'ready']);
    $disk = Mockery::mock(Filesystem::class);
    $disk->shouldReceive('exists')->andReturnTrue();
    $disk->shouldReceive('delete')->andReturnFalse();
    Storage::shouldReceive('disk')->with('media')->andReturn($disk);
    expect(fn () => (new EraseSelfAccount($coach->id))->handle(app(EraseReviewerVoiceNotes::class)))->toThrow(RuntimeException::class);
    expect($review->fresh()->reviewer_id)->toBe($coach->id)->and(Annotation::where('audio_asset_id', $asset->id)->exists())->toBeTrue();
});

it('blocks new voice writes once erase-self has claimed the review', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [, $coach, $speech, $review] = voiceReview();
    $review->update(['voice_erasure_started_at' => now()]);
    $this->actingAs($coach)->post("/api/speeches/{$speech->id}/voice-notes", ['audio' => UploadedFile::fake()->create('note.webm', 10, 'audio/webm'), 'client_uuid' => (string) Str::uuid(), 'start_seconds' => 1])->assertConflict();
    expect(Annotation::where('review_id', $review->id)->count())->toBe(0);
});

it('refuses Undo after purge has claimed the voice asset', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, $coach, $speech, $review] = voiceReview();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'failed', 'purge_claim_id' => (string) Str::uuid()]);
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'ready']);
    $annotation->delete();
    $this->actingAs($coach)->postJson("/api/speeches/{$speech->id}/annotations/{$annotation->id}/restore")->assertConflict();
    expect(Annotation::withTrashed()->find($annotation->id)->trashed())->toBeTrue();
});
