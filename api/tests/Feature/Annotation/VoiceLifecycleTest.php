<?php

use App\Jobs\NormalizeVoiceNote;
use App\Jobs\PurgeDeletedVoiceAnnotation;
use App\Jobs\PurgeVoiceAsset;
use App\Jobs\TranscribeVoiceNote;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use App\Services\ReviewService;
use App\Services\Voice\FakeVoiceNoteProcessor;
use App\Services\Voice\VoiceNoteTranscriberContract;
use App\Services\Voice\VoiceTranscriptionException;
use Database\Seeders\RoleSeeder;
use Illuminate\Contracts\Bus\Dispatcher;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

function makeVoiceLifecycleFixture(): array
{
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $coach = User::factory()->create();
    $coach->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id, 'status' => 'in_progress']);

    return [$coach, $speech, $review];
}

function makeProcessingVoice(User $coach, Speech $speech, Review $review, int $bytes = 20): array
{
    $temporary = 'voice-temp/'.Str::uuid().'/source';
    Storage::disk('media')->put($temporary, str_repeat('x', $bytes));
    User::query()->whereKey($coach->id)->update(['storage_bytes_used' => $bytes]);
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'processing', 'path' => 'voice-final/'.Str::uuid().'.m4a', 'byte_size' => $bytes, 'temporary_path' => $temporary, 'temporary_byte_size' => $bytes, 'updated_at' => now()->subHours(3)]);
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => '', 'transcript_status' => 'pending', 'transcript_attempt_id' => (string) Str::uuid()]);

    return [$asset, $annotation, $temporary];
}

it('makes duplicate normalization deliveries choose one candidate and reconcile quota once', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $speech, $review] = makeVoiceLifecycleFixture();
    [$asset, , $temporary] = makeProcessingVoice($coach, $speech, $review);
    $processor = new FakeVoiceNoteProcessor(app(QuotaService::class));
    expect($processor->process($asset, $temporary))->toBeTrue()->and($processor->process($asset, $temporary))->toBeFalse();
    $fresh = $asset->fresh();
    expect($fresh->status)->toBe('ready')->and($fresh->temporary_path)->toBeNull()->and($coach->fresh()->storage_bytes_used)->toBe(8);
    expect(Storage::disk('media')->allFiles())->toHaveCount(1);
});

it('normalization failed backstop releases its reservation only once', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $speech, $review] = makeVoiceLifecycleFixture();
    [$asset, , $temporary] = makeProcessingVoice($coach, $speech, $review);
    $job = new NormalizeVoiceNote($asset->id, $temporary);
    $error = new RuntimeException('worker lost');
    $job->failed($error);
    $job->failed($error);
    expect($asset->fresh()->status)->toBe('failed')->and($asset->fresh()->temporary_path)->toBeNull()->and($coach->fresh()->storage_bytes_used)->toBe(0);
});

it('reconciles a stale processing voice note and treats a missing temp object idempotently', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $speech, $review] = makeVoiceLifecycleFixture();
    [$asset, , $temporary] = makeProcessingVoice($coach, $speech, $review);
    Storage::disk('media')->delete($temporary);
    $this->artisan('media:reconcile', ['--transcode-hours' => 2])->assertSuccessful();
    $this->artisan('media:reconcile', ['--transcode-hours' => 2])->assertSuccessful();
    expect($asset->fresh()->status)->toBe('failed')->and($asset->fresh()->temporary_path)->toBeNull()->and($coach->fresh()->storage_bytes_used)->toBe(0);
});

it('reconciles the persisted candidate after a kill between normalized upload and ready CAS', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $speech, $review] = makeVoiceLifecycleFixture();
    [$asset, , $temporary] = makeProcessingVoice($coach, $speech, $review);
    $candidate = "speeches/{$speech->ulid}/voice/kill-window.m4a";
    Storage::disk('media')->put($candidate, 'normalized-aac');
    SpeechAsset::query()->whereKey($asset->id)->update(['normalization_candidate_path' => $candidate, 'updated_at' => now()->subHours(3)]);

    $this->artisan('media:reconcile', ['--transcode-hours' => 2])->assertSuccessful();

    $asset->refresh();
    expect($asset->status)->toBe('failed')
        ->and($asset->normalization_candidate_path)->toBeNull()
        ->and($asset->temporary_path)->toBeNull()
        ->and($coach->fresh()->storage_bytes_used)->toBe(0);
    Storage::disk('media')->assertMissing($temporary)->assertMissing($candidate);
});

it('a delayed purge no-ops after restore and preserves its object', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $speech, $review] = makeVoiceLifecycleFixture();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    Storage::disk('media')->put($asset->path, 'voice');
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'ready']);
    $annotation->delete();
    $annotation->restore();
    (new PurgeDeletedVoiceAnnotation($annotation->id))->handle(app(QuotaService::class));
    expect($asset->fresh())->not->toBeNull();
    Storage::disk('media')->assertExists($asset->path);
});

it('review hard purge commits first and queues asset-keyed cleanup', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    Queue::fake();
    [$coach, $speech, $review] = makeVoiceLifecycleFixture();
    [$asset] = makeProcessingVoice($coach, $speech, $review);
    app(ReviewService::class)->revokeAndPurge($review, User::findOrFail($speech->user_id));
    expect(Review::find($review->id))->toBeNull()->and($asset->fresh()->status)->toBe('failed');
    Queue::assertPushed(PurgeVoiceAsset::class, fn ($job) => $job->assetId === $asset->id);
});

it('reconciles a voice tombstone when its delayed purge dispatch was lost', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $speech, $review] = makeVoiceLifecycleFixture();
    User::query()->whereKey($coach->id)->update(['storage_bytes_used' => 5]);
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready', 'byte_size' => 5]);
    Storage::disk('media')->put($asset->path, 'voice');
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'ready']);
    $annotation->delete();
    Annotation::withTrashed()->whereKey($annotation->id)->update(['deleted_at' => now()->subMinute()]);

    $this->artisan('media:reconcile')->assertSuccessful();

    expect($asset->fresh())->toBeNull()->and($coach->fresh()->storage_bytes_used)->toBe(0);
    Storage::disk('media')->assertMissing($asset->path);
});

it('reconciles an asset orphaned when hard-purge dispatch was lost', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $speech, $review] = makeVoiceLifecycleFixture();
    User::query()->whereKey($coach->id)->update(['storage_bytes_used' => 5]);
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create([
        'status' => 'ready',
        'byte_size' => 5,
        'purge_reviewer_id' => $coach->id,
    ]);
    Storage::disk('media')->put($asset->path, 'voice');
    Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'ready']);
    Review::query()->whereKey($review->id)->delete();

    $this->artisan('media:reconcile')->assertSuccessful();

    expect($asset->fresh())->toBeNull()->and($coach->fresh()->storage_bytes_used)->toBe(0);
    Storage::disk('media')->assertMissing($asset->path);
});

it('maps transcript storage failures to the frozen stable code', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, $speech, $review] = makeVoiceLifecycleFixture();
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create(['status' => 'ready']);
    $attempt = (string) Str::uuid();
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'transcript_status' => 'pending', 'transcript_attempt_id' => $attempt]);
    $transcriber = new class implements VoiceNoteTranscriberContract
    {
        public function transcribe(SpeechAsset $asset): string
        {
            throw new VoiceTranscriptionException('voice_transcription_storage_failed');
        }
    };
    (new TranscribeVoiceNote($annotation->id, $asset->id, $attempt))->handle($transcriber);
    expect($annotation->fresh()->transcript_status)->toBe('failed')->and($annotation->fresh()->transcript_failure_code)->toBe('voice_transcription_storage_failed');
});

it('makes a post-normalization transcript dispatch failure retryable instead of pending forever', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $speech, $review] = makeVoiceLifecycleFixture();
    [$asset, $annotation, $temporary] = makeProcessingVoice($coach, $speech, $review);
    $dispatcher = Mockery::mock(Dispatcher::class);
    $dispatcher->shouldReceive('dispatch')->once()->andThrow(new RuntimeException('redis unavailable'));
    app()->instance(Dispatcher::class, $dispatcher);

    expect(fn () => (new NormalizeVoiceNote($asset->id, $temporary))->handle(new FakeVoiceNoteProcessor(app(QuotaService::class))))
        ->toThrow(RuntimeException::class, 'redis unavailable');
    expect($asset->fresh()->status)->toBe('ready')
        ->and($annotation->fresh()->transcript_status)->toBe('failed')
        ->and($annotation->fresh()->transcript_failure_code)->toBe('voice_transcription_failed');
});

it('does not allow an invitation to reintroduce reviewer identity after erasure claim', function () {
    $this->seed(RoleSeeder::class);
    [$coach] = makeVoiceLifecycleFixture();
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $speech = Speech::factory()->for($speaker)->create();
    $coach->update(['erasure_started_at' => now()]);
    expect(fn () => app(ReviewService::class)->invite($speaker, $speech, $coach, null, false, false))->toThrow(HttpException::class);
    expect(Review::where('speech_id', $speech->id)->where('reviewer_id', $coach->id)->exists())->toBeFalse();
});
