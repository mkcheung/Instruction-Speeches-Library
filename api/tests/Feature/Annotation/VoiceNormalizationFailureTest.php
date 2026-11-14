<?php

use App\Jobs\NormalizeVoiceNote;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use App\Services\Voice\FfmpegVoiceNoteProcessor;
use App\Support\ScratchFiles;
use Database\Seeders\RoleSeeder;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

function normalizationFailureFixture(): array
{
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    // 20 bytes reserved by this note, plus 100 held elsewhere: a double release shows up as 80, not a clamped 0.
    $coach = User::factory()->create(['storage_bytes_used' => 120]);
    $coach->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id, 'status' => 'in_progress']);
    $temporary = 'voice-uploads/'.Str::uuid().'/source';
    $candidate = "speeches/{$speech->ulid}/voice/".Str::uuid().'.m4a';
    Storage::disk('media')->put($temporary, str_repeat('x', 20));
    Storage::disk('media')->put($candidate, 'normalized');
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create([
        'status' => 'processing', 'byte_size' => 20, 'temporary_path' => $temporary, 'temporary_byte_size' => 20,
        'normalization_candidate_path' => $candidate, 'updated_at' => now()->subHours(3),
    ]);
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => '', 'transcript_status' => 'pending', 'transcript_attempt_id' => (string) Str::uuid()]);

    return [$coach, $review, $asset, $annotation, $temporary, $candidate];
}

/** Runs one settlement entry point. `$temporary` is the path the caller claims to own. */
function settleNormalizationFailure(string $entry, SpeechAsset $asset, string $temporary): void
{
    if ($entry === 'processor') {
        Process::fake();
        app()->bind(ScratchFiles::class, fn () => new class extends ScratchFiles
        {
            protected function allocate(string $prefix): string|false
            {
                return false; // the scratch-allocation exit: fail(..., 'voice_storage_failed'), FfmpegVoiceNoteProcessor.php:139-140
            }
        });
        expect((new FfmpegVoiceNoteProcessor(app(QuotaService::class)))->process($asset->fresh(), $temporary))->toBeFalse();
    } elseif ($entry === 'backstop') {
        (new NormalizeVoiceNote($asset->id, $temporary))->failed(new RuntimeException('worker lost'));
    } else {
        expect(Artisan::call('media:reconcile', ['--transcode-hours' => 2]))->toBe(0);
    }
}

dataset('normalization failure entries', [
    'processor exit' => ['processor', 'voice_storage_failed', 'We had trouble processing this voice note. Please record it again.'],
    'queued backstop' => ['backstop', 'voice_normalization_failed', 'We had trouble processing this voice note. Please record it again.'],
    'reconcile sweep' => ['reconcile', 'voice_normalization_failed', 'Voice normalization did not complete.'],
]);

/** The N-2/N-3 "untouched" assertions. */
function expectNormalizationUntouched(User $coach, SpeechAsset $asset, Annotation $annotation, string $temporary, string $candidate): void
{
    $fresh = $asset->fresh();
    expect($fresh->status)->toBe('processing')
        ->and($fresh->temporary_byte_size)->toBe(20)
        ->and($fresh->temporary_path)->toBe($temporary)
        ->and($fresh->normalization_candidate_path)->toBe($candidate)
        ->and($coach->fresh()->storage_bytes_used)->toBe(120)
        ->and($annotation->fresh()->transcript_status)->toBe('pending');
    Storage::disk('media')->assertExists($temporary)->assertExists($candidate);
}

it('settles a processing note once: asset and transcript failed, objects and ledger cleared, reservation released once', function (string $entry, string $code, string $detail) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, , $asset, $annotation, $temporary, $candidate] = normalizationFailureFixture();

    settleNormalizationFailure($entry, $asset, $temporary);
    settleNormalizationFailure($entry, $asset, $temporary);

    $fresh = $asset->fresh();
    expect($fresh->status)->toBe('failed')
        ->and($fresh->failure_code)->toBe($code)
        ->and($fresh->failure_detail)->toBe($detail)
        ->and($fresh->temporary_byte_size)->toBeNull()
        ->and($fresh->byte_size)->toBe(0)
        ->and($fresh->temporary_path)->toBeNull()
        ->and($fresh->normalization_candidate_path)->toBeNull()
        ->and($annotation->fresh()->transcript_status)->toBe('failed')
        ->and($coach->fresh()->storage_bytes_used)->toBe(100);
    Storage::disk('media')->assertMissing($temporary)->assertMissing($candidate);
})->with('normalization failure entries');

it('leaves an asset a purge has claimed untouched', function (string $entry) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, , $asset, $annotation, $temporary, $candidate] = normalizationFailureFixture();
    SpeechAsset::query()->whereKey($asset->id)->update(['purge_claim_id' => (string) Str::uuid(), 'updated_at' => now()->subHours(3)]);

    settleNormalizationFailure($entry, $asset, $temporary);

    expectNormalizationUntouched($coach, $asset, $annotation, $temporary, $candidate);
})->with('normalization failure entries');

it('ignores a temporary path it does not own', function (string $entry) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, , $asset, $annotation, $temporary, $candidate] = normalizationFailureFixture();

    settleNormalizationFailure($entry, $asset, 'voice-uploads/someone-else/source');

    expectNormalizationUntouched($coach, $asset, $annotation, $temporary, $candidate);
})->with(['processor', 'backstop']);

it('fails the transcript only while it is still in flight', function (string $entry, string $code, string $detail, string $before, string $after) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, , $asset, $annotation, $temporary] = normalizationFailureFixture();
    $annotation->update(['transcript_status' => $before]);

    settleNormalizationFailure($entry, $asset, $temporary);

    expect($annotation->fresh()->transcript_status)->toBe($after);
})->with('normalization failure entries')->with([
    'processing transcript' => ['processing', 'failed'],
    'ready transcript' => ['ready', 'ready'],
]);

it('skips the release when the reviewer is gone but still fails and cleans the asset', function (string $entry) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $review, $asset, , $temporary] = normalizationFailureFixture();
    Review::query()->whereKey($review->id)->delete();

    settleNormalizationFailure($entry, $asset, $temporary);

    $fresh = $asset->fresh();
    expect($fresh->status)->toBe('failed')
        ->and($fresh->temporary_path)->toBeNull()
        ->and($fresh->normalization_candidate_path)->toBeNull()
        ->and($coach->fresh()->storage_bytes_used)->toBe(120);
})->with('normalization failure entries');

it('keeps the ledger when an object cannot be deleted', function (string $entry) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, , $asset, , $temporary, $candidate] = normalizationFailureFixture();
    $disk = Mockery::mock(Filesystem::class);
    $disk->shouldReceive('exists')->andReturnTrue();
    $disk->shouldReceive('delete')->andReturnFalse();
    Storage::shouldReceive('disk')->with('media')->andReturn($disk);

    settleNormalizationFailure($entry, $asset, $temporary);

    $fresh = $asset->fresh();
    expect($fresh->status)->toBe('failed')
        ->and($fresh->temporary_byte_size)->toBeNull()
        ->and($coach->fresh()->storage_bytes_used)->toBe(100)
        ->and($fresh->temporary_path)->toBe($temporary)
        ->and($fresh->normalization_candidate_path)->toBe($candidate);
})->with('normalization failure entries');

it('clears the transcript failure code when it fails the transcript', function (string $entry) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, , $asset, $annotation, $temporary] = normalizationFailureFixture();
    $annotation->update(['transcript_failure_code' => 'voice_transcription_failed']);

    settleNormalizationFailure($entry, $asset, $temporary);

    expect($annotation->fresh()->transcript_status)->toBe('failed')
        ->and($annotation->fresh()->transcript_failure_code)->toBeNull();
})->with('normalization failure entries');

it('leaves the ledger alone if the asset left failed during cleanup', function (string $entry) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [, , $asset, , $temporary] = normalizationFailureFixture();
    $disk = Mockery::mock(Filesystem::class);
    $disk->shouldReceive('exists')->andReturnTrue();
    $disk->shouldReceive('delete')->andReturnUsing(function () use ($asset) {
        SpeechAsset::query()->whereKey($asset->id)->update(['status' => 'ready']);

        return true;
    });
    Storage::shouldReceive('disk')->with('media')->andReturn($disk);

    settleNormalizationFailure($entry, $asset, $temporary);

    expect($asset->fresh()->temporary_path)->toBe($temporary);
})->with('normalization failure entries');

it('the reconcile sweep skips a note a purge claimed after the sweep selected it', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, , $asset, $annotation, $temporary] = normalizationFailureFixture();
    $stamped = false;
    SpeechAsset::retrieved(function (SpeechAsset $loaded) use ($asset, &$stamped): void {
        if (! $stamped && $loaded->id === $asset->id) {
            $stamped = true;
            SpeechAsset::query()->whereKey($asset->id)->update(['purge_claim_id' => (string) Str::uuid()]);
        }
    });

    settleNormalizationFailure('reconcile', $asset, $temporary);

    expect($stamped)->toBeTrue()
        ->and($asset->fresh()->status)->toBe('processing')
        ->and($coach->fresh()->storage_bytes_used)->toBe(120)
        ->and($annotation->fresh()->transcript_status)->toBe('pending');
});
