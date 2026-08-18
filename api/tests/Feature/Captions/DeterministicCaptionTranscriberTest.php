<?php

use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\DeterministicCaptionTranscriber;
use Illuminate\Redis\Connections\Connection;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Mockery\MockInterface;

/**
 * STEP-09-VERIFICATION-PLAN.md §3.1/§4.2 point 3's `caption-test-worker`
 * binding. CI's Pest job has no live Redis service (see
 * tests/Feature/Speech/QueueStatusTest.php's own docblock) so, exactly
 * like that test, `Redis::connection()` is mocked rather than hitting a
 * real Valkey instance — this suite is proving the class's own logic
 * (release-key protocol, guarded compare-and-set write, timeout-to-failed
 * path), not a real hold/release round trip against a real worker
 * process. THAT — a real queued job actually blocking and being released
 * by a bash script driving redis-cli against a live Valkey — is exactly
 * what scripts/verify-caption-worker-isolation.sh and
 * scripts/verify-caption-concurrency.sh exist to prove instead; it cannot
 * be proven here without either a live Redis or a second PHP process, and
 * this file deliberately doesn't fake either.
 */
function mockCaptionTestWorkerRedis(?string $releaseValue): MockInterface
{
    $connection = Mockery::mock(Connection::class);
    $connection->shouldReceive('get')->andReturn($releaseValue);
    $connection->shouldReceive('setex')->andReturn(true);
    Redis::shouldReceive('connection')->andReturn($connection);

    return $connection;
}

it('proceeds immediately and writes a real VTT/transcript when already released', function () {
    Storage::fake('media');
    mockCaptionTestWorkerRedis('1');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId,
    ]);

    (new DeterministicCaptionTranscriber)->transcribe($source, $captions, $attemptId);

    $fresh = $captions->fresh();
    expect($fresh->status)->toBe('ready');
    Storage::disk('media')->assertExists($fresh->path);
    expect(Storage::disk('media')->get($fresh->path))->toContain('deterministic test transcript');

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->source)->toBe('whisper');
    expect($transcript->model)->toBe('caption-test-worker');
    expect($transcript->body)->toContain('Held and released by caption-test-worker controls');
});

it('does not clobber a newer attempt once released, same compare-and-set guard as WhisperTranscriber', function () {
    Storage::fake('media');
    mockCaptionTestWorkerRedis('1');

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);

    $attemptA = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptA,
    ]);

    // Attempt B rotates onto the row before A's (already-released) write
    // lands — the same race WhisperTranscriberTest's equivalent case
    // covers.
    $attemptB = (string) Str::uuid();
    $captions->update(['caption_attempt_id' => $attemptB, 'caption_queued_at' => now()]);

    (new DeterministicCaptionTranscriber)->transcribe($source, $captions, $attemptA);

    $fresh = $captions->fresh();
    expect($fresh->status)->toBe('processing');
    expect($fresh->caption_attempt_id)->toBe($attemptB);
    Storage::disk('media')->assertMissing($fresh->path);
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('fails the row without throwing once the hold exceeds its max wait', function () {
    Storage::fake('media');
    mockCaptionTestWorkerRedis(null);

    $speech = Speech::factory()->create();
    $source = SpeechAsset::factory()->for($speech)->create(['disk' => 'media', 'status' => 'ready']);
    $attemptId = (string) Str::uuid();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'processing', 'caption_attempt_id' => $attemptId,
    ]);

    // A near-zero ceiling — never the real 120s default — so this proves
    // the timeout branch itself resolves to `failed` without a slow test.
    (new DeterministicCaptionTranscriber(maxWaitSeconds: 0, pollMicroseconds: 1_000))
        ->transcribe($source, $captions, $attemptId);

    $fresh = $captions->fresh();
    expect($fresh->status)->toBe('failed');
    expect($fresh->failure_code)->toBe('transcription_failed');
    Storage::disk('media')->assertMissing($fresh->path);
});
