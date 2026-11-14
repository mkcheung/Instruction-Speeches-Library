<?php

use App\Jobs\PurgeDeletedVoiceAnnotation;
use App\Jobs\PurgeVoiceAsset;
use App\Models\Annotation;
use App\Models\Review;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\User;
use App\Services\QuotaService;
use App\Services\StorageObjectRemover;
use App\Services\Voice\EraseReviewerVoiceNotes;
use Database\Seeders\RoleSeeder;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

function voicePurgeFixture(string $caller, string $status = 'ready'): array
{
    $speaker = User::factory()->create();
    $speaker->assignRole('member');
    $coach = User::factory()->create(['storage_bytes_used' => 120]);
    $coach->assignRole('coach');
    $speech = Speech::factory()->for($speaker)->create();
    $review = Review::factory()->accepted()->create(['speech_id' => $speech->id, 'speech_owner_id' => $speaker->id, 'reviewer_id' => $coach->id, 'status' => 'in_progress']);
    $temporary = 'voice-uploads/'.Str::uuid().'/source';
    $asset = SpeechAsset::factory()->voiceNote()->for($speech)->create([
        'status' => $status, 'byte_size' => 8, 'temporary_path' => $temporary, 'temporary_byte_size' => 20,
    ]);
    Storage::disk('media')->put($temporary, 'raw-voice');
    Storage::disk('media')->put($asset->path, 'voice');
    $annotation = Annotation::factory()->for($review)->create(['audio_asset_id' => $asset->id, 'body' => 'Kept transcript.', 'transcript_status' => 'ready']);
    if ($caller === 'purge deleted note') {
        $annotation->delete();
    }

    return [$coach, $asset, $annotation];
}

function runVoicePurge(string $caller, SpeechAsset $asset, Annotation $annotation, User $coach): void
{
    match ($caller) {
        'purge asset' => (new PurgeVoiceAsset($asset->id, $coach->id))->handle(app(QuotaService::class)),
        'purge deleted note' => (new PurgeDeletedVoiceAnnotation($annotation->id))->handle(app(QuotaService::class)),
        'erase reviewer' => app(EraseReviewerVoiceNotes::class)->execute($coach),
    };
}

/** Records the asset's purge_claim_id at the moment its objects are deleted. */
function bindRecordingVoicePurgeRemover(int $assetId, ArrayObject $seen): void
{
    app()->instance(StorageObjectRemover::class, new class($assetId, $seen) extends StorageObjectRemover
    {
        public function __construct(private int $assetId, private ArrayObject $seen) {}

        public function deleteExisting(string $disk, array $paths, string $failureMessage): void
        {
            $this->seen[] = SpeechAsset::query()->whereKey($this->assetId)->value('purge_claim_id');
            parent::deleteExisting($disk, $paths, $failureMessage);
        }
    });
}

/** Lands one concurrent write on the asset between claim and finalize. */
function bindInterleavingVoicePurgeRemover(int $assetId, array $write): void
{
    app()->instance(StorageObjectRemover::class, new class($assetId, $write) extends StorageObjectRemover
    {
        public function __construct(private int $assetId, private array $write) {}

        public function deleteExisting(string $disk, array $paths, string $failureMessage): void
        {
            SpeechAsset::query()->whereKey($this->assetId)->update($this->write);
            parent::deleteExisting($disk, $paths, $failureMessage);
        }
    });
}

function bindFailingVoicePurgeRemover(): void
{
    app()->instance(StorageObjectRemover::class, new class extends StorageObjectRemover
    {
        public function deleteExisting(string $disk, array $paths, string $failureMessage): void
        {
            throw new RuntimeException($failureMessage);
        }
    });
}

dataset('voice purge callers', ['purge asset', 'purge deleted note', 'erase reviewer']);

it('reuses an existing purge claim id', function (string $caller) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $asset, $annotation] = voicePurgeFixture($caller);
    SpeechAsset::query()->whereKey($asset->id)->update(['purge_claim_id' => 'pre-existing-claim']);
    $seen = new ArrayObject;
    bindRecordingVoicePurgeRemover($asset->id, $seen);

    runVoicePurge($caller, $asset, $annotation, $coach);

    expect($seen->getArrayCopy())->toBe(['pre-existing-claim'])
        ->and(SpeechAsset::find($asset->id))->toBeNull();
})->with('voice purge callers');

it('reads the bytes to release at finalize, except the deleted-note purge, which reads them at claim', function (string $caller, int $expected) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $asset, $annotation] = voicePurgeFixture($caller);
    bindInterleavingVoicePurgeRemover($asset->id, ['temporary_byte_size' => null]);

    runVoicePurge($caller, $asset, $annotation, $coach);

    expect($coach->fresh()->storage_bytes_used)->toBe($expected);
})->with([
    'purge asset' => ['purge asset', 112],
    'erase reviewer' => ['erase reviewer', 112],
    'purge deleted note' => ['purge deleted note', 100],
]);

it('stamps the claim and the caller\'s status before deleting, and keeps the row when deletion fails', function (string $caller, string $initial, string $status, ?string $code, ?string $detail, string $message) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $asset, $annotation] = voicePurgeFixture($caller, $initial);
    bindFailingVoicePurgeRemover();

    expect(fn () => runVoicePurge($caller, $asset, $annotation, $coach))->toThrow(RuntimeException::class, $message);

    $fresh = $asset->fresh();
    expect($fresh->purge_claim_id)->not->toBeNull()
        ->and($fresh->status)->toBe($status)
        ->and($fresh->failure_code)->toBe($code)
        ->and($fresh->failure_detail)->toBe($detail)
        ->and($coach->fresh()->storage_bytes_used)->toBe(120)
        ->and(Annotation::withTrashed()->find($annotation->id)->audio_asset_id)->toBe($asset->id);
})->with([
    'purge asset, ready' => ['purge asset', 'ready', 'ready', null, null, 'Voice asset purge failed.'],
    'purge asset, processing' => ['purge asset', 'processing', 'processing', null, null, 'Voice asset purge failed.'],
    'purge deleted note, ready' => ['purge deleted note', 'ready', 'failed', null, null, 'Voice-note object deletion failed.'],
    'purge deleted note, processing' => ['purge deleted note', 'processing', 'failed', null, null, 'Voice-note object deletion failed.'],
    'erase reviewer, ready' => ['erase reviewer', 'ready', 'ready', null, null, 'Voice-note erasure failed; reviewer identity was retained.'],
    'erase reviewer, processing' => ['erase reviewer', 'processing', 'failed', 'voice_storage_failed', 'Voice note is being erased.', 'Voice-note erasure failed; reviewer identity was retained.'],
]);

it('a hard purge without a reviewer id refunds the recorded purge reviewer', function () {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $asset] = voicePurgeFixture('purge asset');
    SpeechAsset::query()->whereKey($asset->id)->update(['purge_reviewer_id' => $coach->id]);

    (new PurgeVoiceAsset($asset->id, null))->handle(app(QuotaService::class));

    expect($coach->fresh()->storage_bytes_used)->toBe(100);
});

it('releases the bytes once across two runs', function (string $caller) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $asset, $annotation] = voicePurgeFixture($caller);

    runVoicePurge($caller, $asset, $annotation, $coach);
    runVoicePurge($caller, $asset, $annotation, $coach);

    expect($coach->fresh()->storage_bytes_used)->toBe(100)
        ->and(SpeechAsset::find($asset->id))->toBeNull();
})->with('voice purge callers');

it('finalizes only while its claim still owns the row', function (string $caller) {
    $this->seed(RoleSeeder::class);
    Storage::fake('media');
    [$coach, $asset, $annotation] = voicePurgeFixture($caller);
    bindInterleavingVoicePurgeRemover($asset->id, ['purge_claim_id' => 'another-runner']);

    runVoicePurge($caller, $asset, $annotation, $coach);

    expect(SpeechAsset::find($asset->id))->not->toBeNull()
        ->and($coach->fresh()->storage_bytes_used)->toBe(120)
        ->and(Annotation::withTrashed()->find($annotation->id)->audio_asset_id)->toBe($asset->id);
})->with('voice purge callers');
