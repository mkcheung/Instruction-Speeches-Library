<?php

use App\Jobs\RederiveTranscript;
use App\Models\Speech;
use App\Models\SpeechAsset;
use App\Models\SpeechTranscript;
use App\Services\Captions\CaptionRevision;
use App\Services\Captions\CaptionRevisionMismatchException;
use App\Services\Captions\CaptionStorageReadException;
use App\Services\Captions\TranscriptDeriver;
use Illuminate\Support\Facades\Storage;

/**
 * STEP-09-VERIFICATION-PLAN.md §4.1 "Projection convergence token" / §4.2
 * point 2. This job re-reads the (already-edited, already-persisted-as-
 * canonical) VTT off storage and turns it into the speech_transcripts row,
 * source = 'edited' — but only for the exact `content_revision` it was
 * dispatched with; a superseded job (an older revision than what's
 * currently on the asset) must be a clean no-op.
 */
it('routes to the redis connection and default queue, not redis-long/captions', function () {
    Storage::fake('media');
    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);

    $job = new RederiveTranscript($captions->id, 'any-revision');

    expect($job->connection)->toBe('redis');
    expect($job->queue)->toBe('default');
});

it('re-derives the transcript from the stored VTT and sets source to edited', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);

    $vtt = <<<'VTT'
        WEBVTT

        00:00:00.000 --> 00:00:30.000
        Toastmasters, not toast masters.
        VTT;

    $revision = CaptionRevision::compute($vtt);
    Storage::disk('media')->put($captions->path, $vtt);
    $captions->update(['content_revision' => $revision]);

    (new RederiveTranscript($captions->id, $revision))->handle(new TranscriptDeriver);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->source)->toBe('edited');
    expect($transcript->body)->toBe('Toastmasters, not toast masters.');
    expect($transcript->word_count)->toBe(4);
    expect($transcript->caption_revision)->toBe($revision);
});

it('preserves the prior model/language across an edit rather than resetting them', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    SpeechTranscript::factory()->for($speech)->create(['model' => 'whisper.cpp-small.en', 'language' => 'fr', 'source' => 'whisper']);
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);

    $vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBonjour.";
    $revision = CaptionRevision::compute($vtt);
    Storage::disk('media')->put($captions->path, $vtt);
    $captions->update(['content_revision' => $revision]);

    (new RederiveTranscript($captions->id, $revision))->handle(new TranscriptDeriver);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->model)->toBe('whisper.cpp-small.en');
    expect($transcript->language)->toBe('fr');
    expect($transcript->source)->toBe('edited');
    expect($transcript->caption_revision)->toBe($revision);
});

it('is a no-op if the captions asset is not ready', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'processing']);

    (new RederiveTranscript($captions->id, 'irrelevant'))->handle(new TranscriptDeriver);

    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('is a clean no-op when the job is superseded by a newer revision before reading storage', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'ready', 'content_revision' => 'newer-revision',
    ]);
    Storage::disk('media')->put($captions->path, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nNewer.");

    (new RederiveTranscript($captions->id, 'stale-revision'))->handle(new TranscriptDeriver);

    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('directly invoking the job twice for consecutive edits converges on the newest revision', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);

    $firstVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFirst edit.";
    $firstRevision = CaptionRevision::compute($firstVtt);

    $secondVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSecond edit.";
    $secondRevision = CaptionRevision::compute($secondVtt);

    // Simulates two rapid consecutive edits racing: the SECOND edit's
    // storage write and content_revision land first (as a real worker
    // could reorder queued jobs), then the stale first job runs.
    Storage::disk('media')->put($captions->path, $secondVtt);
    $captions->update(['content_revision' => $secondRevision]);

    (new RederiveTranscript($captions->id, $firstRevision))->handle(new TranscriptDeriver);
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();

    (new RederiveTranscript($captions->id, $secondRevision))->handle(new TranscriptDeriver);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->body)->toBe('Second edit.');
    expect($transcript->caption_revision)->toBe($secondRevision);
});

it('a forced overlap where an older attempt runs after a newer one already wrote does not clobber the newer transcript', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);

    $firstVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOlder text.";
    $firstRevision = CaptionRevision::compute($firstVtt);
    Storage::disk('media')->put($captions->path, $firstVtt);
    $captions->update(['content_revision' => $firstRevision]);

    (new RederiveTranscript($captions->id, $firstRevision))->handle(new TranscriptDeriver);
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->sole()->body)->toBe('Older text.');

    $secondVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nNewer text.";
    $secondRevision = CaptionRevision::compute($secondVtt);
    Storage::disk('media')->put($captions->path, $secondVtt);
    $captions->update(['content_revision' => $secondRevision]);
    (new RederiveTranscript($captions->id, $secondRevision))->handle(new TranscriptDeriver);
    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->sole()->body)->toBe('Newer text.');

    // The overlap: a stale worker for the FIRST (already-superseded)
    // revision runs last, after the newer transcript already landed.
    (new RederiveTranscript($captions->id, $firstRevision))->handle(new TranscriptDeriver);

    $transcript = SpeechTranscript::query()->where('speech_id', $speech->id)->sole();
    expect($transcript->body)->toBe('Newer text.');
    expect($transcript->caption_revision)->toBe($secondRevision);
});

it('treats missing storage bytes as retryable rather than acknowledging success', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'ready', 'content_revision' => 'some-revision',
    ]);
    // Deliberately never written to storage.

    expect(fn () => (new RederiveTranscript($captions->id, 'some-revision'))->handle(new TranscriptDeriver))
        ->toThrow(CaptionStorageReadException::class);

    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('a still-current stored-bytes mismatch throws a storage-integrity failure rather than silently succeeding', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create([
        'disk' => 'media', 'status' => 'ready', 'content_revision' => 'expected-revision',
    ]);
    // Bytes on disk don't hash to 'expected-revision' and content_revision
    // never changes underneath this job — a genuine corruption case, not a
    // benign supersession.
    Storage::disk('media')->put($captions->path, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCorrupted.");

    expect(fn () => (new RederiveTranscript($captions->id, 'expected-revision'))->handle(new TranscriptDeriver))
        ->toThrow(CaptionRevisionMismatchException::class);

    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});

it('a locked-recheck-during-parsing race lets a newer edit landing mid-derivation supersede this job', function () {
    Storage::fake('media');

    $speech = Speech::factory()->create();
    $captions = SpeechAsset::factory()->for($speech)->captions()->create(['disk' => 'media', 'status' => 'ready']);

    $firstVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nBeing derived.";
    $firstRevision = CaptionRevision::compute($firstVtt);
    Storage::disk('media')->put($captions->path, $firstVtt);
    $captions->update(['content_revision' => $firstRevision]);

    // Simulates a newer edit committing between this job's initial read
    // and its locked recheck immediately before the transcript write: by
    // the time handle() reaches the locked recheck, the row already
    // reflects a different revision.
    $secondVtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nLanded mid-derivation.";
    $secondRevision = CaptionRevision::compute($secondVtt);
    Storage::disk('media')->put($captions->path, $secondVtt);
    $captions->update(['content_revision' => $secondRevision]);

    (new RederiveTranscript($captions->id, $firstRevision))->handle(new TranscriptDeriver);

    expect(SpeechTranscript::query()->where('speech_id', $speech->id)->exists())->toBeFalse();
});
